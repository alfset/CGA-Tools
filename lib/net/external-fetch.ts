interface ExternalFetchTextOptions {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
}

interface ExternalFetchTextResult {
  contentType: string;
  text: string;
  finalUrl: string;
  truncated: boolean;
}

function isIpfsLikeUrl(url: string): boolean {
  const value = url.toLowerCase();
  return (
    value.startsWith("ipfs://") ||
    value.startsWith("ipns://") ||
    value.includes("/ipfs/") ||
    value.includes("/ipns/") ||
    value.includes(".ipfs.") ||
    value.includes(".ipns.")
  );
}

async function readTextCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const text = (await response.text()).slice(0, maxBytes);
    return {
      text,
      truncated: text.length >= maxBytes
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      const overflow = totalBytes - maxBytes;
      const keepLength = Math.max(0, value.byteLength - overflow);
      if (keepLength > 0) {
        text += decoder.decode(value.subarray(0, keepLength), { stream: true });
      }
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        // ignore cancellation error
      }
      break;
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return { text, truncated };
}

export async function fetchExternalText(url: string, options: ExternalFetchTextOptions = {}): Promise<ExternalFetchTextResult> {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1000, Number(options.timeoutMs)) : 10000;
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.max(1024, Number(options.maxBytes)) : 300000;
  const accept = options.accept || "application/json,text/plain,text/markdown,text/html,*/*";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    accept
  };

  if (isIpfsLikeUrl(url)) {
    headers.range = `bytes=0-${maxBytes - 1}`;
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      cache: "no-store",
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`Source returned ${response.status}`);
    }

    const { text, truncated } = await readTextCapped(response, maxBytes);
    return {
      contentType: response.headers.get("content-type") || "",
      text,
      finalUrl: response.url || url,
      truncated
    };
  } finally {
    clearTimeout(timeout);
  }
}

