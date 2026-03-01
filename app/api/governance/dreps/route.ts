import { NextRequest, NextResponse } from "next/server";
import { getGovernanceProvider } from "@/lib/cardano/provider";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const network = request.nextUrl.searchParams.get("network") || process.env.CARDANO_NETWORK || "mainnet";
    const provider = getGovernanceProvider(network);
    const dreps = await provider.fetchDreps(network);

    return NextResponse.json({
      ok: true,
      provider: provider.name,
      network,
      count: dreps.length,
      activeCount: dreps.filter((drep) => drep.active).length,
      dreps
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected error"
      },
      { status: 500 }
    );
  }
}
