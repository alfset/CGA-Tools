import Link from "next/link";
import { GovernanceRole } from "@/lib/cardano/types";
import { ensureFreshData } from "@/lib/scraper/service";

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  role?: string;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function parseRole(value?: string): GovernanceRole | null {
  const normalized = (value || "").toUpperCase();
  if (normalized === "DREP" || normalized === "SPO" || normalized === "CC") {
    return normalized;
  }
  return null;
}

function votePct(value: number, total: number): number {
  if (!total) {
    return 0;
  }
  return (value / total) * 100;
}

function shortId(value: string, size = 16): string {
  if (value.length <= size) {
    return value;
  }
  return `${value.slice(0, size)}...`;
}

function roleWhois(role: GovernanceRole): string {
  if (role === "DREP") {
    return "Delegated Representative";
  }
  if (role === "SPO") {
    return "Stake Pool Operator";
  }
  return "Constitutional Committee";
}

export default async function ParticipantsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = (searchParams.q || "").trim().toLowerCase();
  const role = parseRole(searchParams.role);
  const { snapshot } = await ensureFreshData(false);

  const votes = (snapshot?.votes || []).filter((vote) => {
    if (role && vote.role !== role) {
      return false;
    }
    return true;
  });

  const proposals = snapshot?.proposals || [];
  const drepById = new Map((snapshot?.dreps || []).map((drep) => [drep.id, drep]));
  const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));

  const map = new Map<string, {
    voterId: string;
    role: GovernanceRole;
    totalVotes: number;
    yes: number;
    no: number;
    abstain: number;
    proposals: Set<string>;
    lastVoteAt?: string;
  }>();

  for (const vote of votes) {
    const key = `${vote.role}|${vote.voterId}`;
    const row = map.get(key) || {
      voterId: vote.voterId,
      role: vote.role,
      totalVotes: 0,
      yes: 0,
      no: 0,
      abstain: 0,
      proposals: new Set<string>(),
      lastVoteAt: undefined
    };

    row.totalVotes += 1;
    if (vote.choice === "yes") {
      row.yes += 1;
    }
    if (vote.choice === "no") {
      row.no += 1;
    }
    if (vote.choice === "abstain") {
      row.abstain += 1;
    }

    row.proposals.add(vote.proposalId);

    if (vote.timestamp) {
      if (!row.lastVoteAt || new Date(vote.timestamp).getTime() > new Date(row.lastVoteAt).getTime()) {
        row.lastVoteAt = vote.timestamp;
      }
    }

    map.set(key, row);
  }

  const participants = Array.from(map.values())
    .map((row) => ({
      ...row,
      votedProposalCount: row.proposals.size,
      participationRate: proposals.length ? Number((row.proposals.size / proposals.length).toFixed(4)) : 0,
      whois: roleWhois(row.role),
      displayName:
        row.role === "DREP"
          ? drepById.get(row.voterId)?.name || `DRep ${shortId(row.voterId)}`
          : row.role === "SPO"
            ? `SPO ${shortId(row.voterId)}`
            : `CC ${shortId(row.voterId)}`,
      country: row.role === "DREP" ? drepById.get(row.voterId)?.country : undefined
    }))
    .filter((row) => {
      if (!query) {
        return true;
      }
      const haystack = [row.voterId, row.displayName, row.whois, row.country || ""].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 120);

  const matchedVotes = participants.reduce((sum, row) => sum + row.totalVotes, 0);

  return (
    <main className="page dashboard">
      <header className="card dashboard-header">
        <h1>Governance Participant Search</h1>
        <p>Search partisipasi voting spesifik untuk DRep, SPO, dan CC lintas proposal.</p>
        <div className="actions">
          <Link href="/" className="btn btn-outline">
            Back To Dashboard
          </Link>
          <Link href="/api/governance/participants" className="btn btn-outline">
            Participants API
          </Link>
        </div>
      </header>

      <section className="card">
        <form className="filter-form" method="get">
          <label>
            Voter / DRep / SPO / CC / Country
            <input type="text" name="q" defaultValue={searchParams.q || ""} placeholder="drep id, nama, country, pool..." />
          </label>
          <label>
            Role
            <select name="role" defaultValue={(role || "") as string}>
              <option value="">All</option>
              <option value="DREP">DREP</option>
              <option value="SPO">SPO</option>
              <option value="CC">CC</option>
            </select>
          </label>
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </section>

      <section className="stats-grid">
        <article className="card stat-card">
          <p className="label">Matched Votes</p>
          <p className="value">{matchedVotes}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Matched Participants</p>
          <p className="value">{participants.length}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Total Proposals</p>
          <p className="value">{proposals.length}</p>
        </article>
      </section>

      <section className="card table-card">
        <h2>Participant Metrics (DRep / SPO / CC)</h2>
        {!participants.length ? (
          <p className="muted">Tidak ada partisipan sesuai filter.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Whois</th>
                <th>Country</th>
                <th>Participant ID</th>
                <th>Role</th>
                <th>Total Votes</th>
                <th>Voted Proposals</th>
                <th>Participation</th>
                <th>Last Vote</th>
                <th>Vote Chart</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((row) => (
                <tr key={`${row.role}-${row.voterId}`}>
                  <td>{row.displayName}</td>
                  <td>{row.whois}</td>
                  <td>{row.country || "-"}</td>
                  <td title={row.voterId}>{row.voterId}</td>
                  <td>{row.role}</td>
                  <td>{row.totalVotes}</td>
                  <td>{row.votedProposalCount}</td>
                  <td>{pct(row.participationRate)}</td>
                  <td>{row.lastVoteAt ? new Date(row.lastVoteAt).toLocaleString() : "-"}</td>
                  <td>
                    <div className="mini-chart" role="img" aria-label="yes no abstain chart">
                      <span className="segment yes" style={{ width: `${votePct(row.yes, row.totalVotes)}%` }} />
                      <span className="segment no" style={{ width: `${votePct(row.no, row.totalVotes)}%` }} />
                      <span className="segment abstain" style={{ width: `${votePct(row.abstain, row.totalVotes)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {participants.length ? (
        <section className="card">
          <h2>Top Participant Proposal List</h2>
          <ul className="simple-list">
            {Array.from(participants[0].proposals)
              .slice(0, 25)
              .map((proposalId) => (
                <li key={proposalId}>
                  <Link href={`/proposals/${encodeURIComponent(proposalId)}`}>
                    {proposalById.get(proposalId)?.title || "Untitled Governance Proposal"}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
