// ENS for the X-Ray (borst 2026-11-21): a name in, the address it points to out, read on Ethereum mainnet from the
// browser through public RPCs (the same two Cross-chain uses). viem does the ENSIP-15 normalisation and the
// universal-resolver call; its reverse lookup checks the name resolves back to the address before returning it.
// Loaded on demand so viem's ENS code never sits on the page's first load. Read only: nothing is signed or sent.

const RPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"];

type Client = { getEnsAddress: (a: { name: string }) => Promise<string | null>; getEnsName: (a: { address: `0x${string}` }) => Promise<string | null> };
let client: Promise<{ c: Client; normalize: (s: string) => string }> | null = null;

function load() {
  if (!client) {
    client = (async () => {
      const [{ createPublicClient, http, fallback }, { mainnet }, { normalize }] = await Promise.all([
        import("viem"), import("viem/chains"), import("viem/ens"),
      ]);
      const c = createPublicClient({ chain: mainnet, transport: fallback(RPCS.map((u) => http(u, { timeout: 8000, retryCount: 1 }))) });
      return { c: c as unknown as Client, normalize };
    })();
    client.catch(() => { client = null; }); // a failed load can be retried
  }
  return client;
}

export type EnsResult = { address: string } | { error: string };

/** Forward: "vitalik.eth" → its address. A name that doesn't normalise or points nowhere says so. */
export async function resolveEnsName(name: string): Promise<EnsResult> {
  let n: string;
  let lib: Awaited<ReturnType<typeof load>>;
  try { lib = await load(); } catch { return { error: "Couldn’t load the ENS reader. Try again." }; }
  try { n = lib.normalize(name); } catch { return { error: `“${name}” isn’t a valid ENS name.` }; }
  try {
    const a = await lib.c.getEnsAddress({ name: n });
    if (!a || /^0x0{40}$/i.test(a)) return { error: `${n} doesn’t point to an address.` };
    return { address: a };
  } catch {
    return { error: "Couldn’t reach Ethereum to look up the name. Try again, or paste the 0x address." };
  }
}

/** Reverse: the address's primary name, only if that name resolves back to it. null on anything else. */
export async function primaryEnsName(address: string): Promise<string | null> {
  try {
    const lib = await load();
    return (await lib.c.getEnsName({ address: address as `0x${string}` })) || null;
  } catch { return null; }
}
