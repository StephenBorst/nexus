// A fake Orderly /tv/history that behaves like the real one on the point that matters: resolution
// 240 answers {"s":"no_data"} for every range, resolution 60 serves one candle per whole hour in
// [from, to] (both ends inclusive, as Orderly's are, so adjoining pages share their edge hour).
// `price(tSec)` sets the close; open = the previous hour's close, high/low = ±0.2% around them.
// `calls` records every URL so a test can assert nothing asked for 240.
export function fakeTvHistory({ price = (t) => 100 + t / 3600 / 1000, fail = () => false } = {}) {
  const calls = [];
  const get = (rawUrl) => {
    const url = new URL(String(rawUrl));
    calls.push(String(rawUrl));
    if (fail(url)) throw new Error("page failed");
    const res = url.searchParams.get("resolution");
    if (res === "240") return { s: "no_data" };
    if (res !== "60") return { s: "error", errmsg: `unsupported resolution ${res}` };
    const from = Number(url.searchParams.get("from")), to = Number(url.searchParams.get("to"));
    const out = { s: "ok", t: [], o: [], h: [], l: [], c: [], v: [] };
    for (let t = Math.ceil(from / 3600) * 3600; t <= to; t += 3600) {
      const c = price(t), o = price(t - 3600);
      out.t.push(t); out.o.push(o); out.c.push(c);
      out.h.push(Math.max(o, c) * 1.002); out.l.push(Math.min(o, c) * 0.998); out.v.push(1);
    }
    return out.t.length ? out : { s: "no_data" };
  };
  return { get, calls };
}
