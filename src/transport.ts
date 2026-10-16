import * as http from "node:http";
import * as https from "node:https";
import * as tls from "node:tls";

let trustedAgent: https.Agent | undefined;
function agent(): https.Agent {
  if (!trustedAgent) {
    // Node fetch does not automatically use Windows' trusted certificate store.
    // Retain bundled/extra roots and add the OS roots on runtimes that expose them.
    const certificates =
      typeof tls.getCACertificates === "function"
        ? [
            ...new Set([
              ...tls.getCACertificates("default"),
              ...tls.getCACertificates("system"),
            ]),
          ]
        : undefined;
    trustedAgent = new https.Agent({
      keepAlive: true,
      ...(certificates ? { ca: certificates } : {}),
    });
  }
  return trustedAgent;
}

/** Small HTTP transport for our JSON API requests, with OS trust and no redirects. */
export const fetchWithSystemTrust: typeof fetch = async (
  input,
  options = {},
) => {
  const url =
    input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Unsupported protocol.");
  const headers = Object.fromEntries(new Headers(options.headers).entries());
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: options.method ?? "GET",
        headers,
        signal: options.signal ?? undefined,
        ...(url.protocol === "https:" ? { agent: agent() } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 500;
          if (status >= 300 && status < 400) {
            reject(
              new Error(
                "The server redirected the request. Enter its final server URL.",
              ),
            );
            return;
          }
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined)
              responseHeaders.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
          }
          try {
            resolve(
              new Response(
                [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
                { status, headers: responseHeaders },
              ),
            );
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    if (options.body !== undefined && options.body !== null)
      request.write(options.body);
    request.end();
  });
};
