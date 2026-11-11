// api/[...path].js  -  Vercel serverless proxy
// forwards /medstat/api/* to Render so the browser never touches onrender.com
const TARGET = "https://medstat-3rxl.onrender.com";

const REQ_HEADERS_TO_DROP = new Set([
  "host","connection","content-length","accept-encoding",
  "x-forwarded-host","x-forwarded-port","x-forwarded-proto",
  "x-vercel-id","x-vercel-cache","x-vercel-deployment-url",
  "x-vercel-forwarded-for","x-vercel-internal","x-vercel-ip-city",
  "x-vercel-ip-country","x-vercel-ip-country-region","x-vercel-ip-latitude",
  "x-vercel-ip-longitude","x-vercel-ip-timezone","x-vercel-proxied-for",
  "x-vercel-signature","x-vercel-trace","forwarded","cdn-loop",
]);

const RES_HEADERS_TO_DROP = new Set([
  "content-encoding","content-length","transfer-encoding",
  "connection","keep-alive","server","strict-transport-security",
]);

module.exports = async function handler(req, res) {
  try {
    const tail = Array.isArray(req.query.path)
      ? req.query.path.join("/")
      : req.query.path || "";
    const qsIndex = (req.url || "").indexOf("?");
    const qs = qsIndex >= 0 ? req.url.slice(qsIndex) : "";
    const url = `${TARGET}/api/${tail}${qs}`;

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const body = hasBody && chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!REQ_HEADERS_TO_DROP.has(key)) headers[key] = value;
    }

    let upstream;
    try {
      upstream = await fetch(url, { method: req.method, headers, body, redirect: "manual" });
    } catch (upstreamErr) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "upstream_unreachable",
        message: String((upstreamErr && upstreamErr.message) || upstreamErr) }));
      return;
    }

    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (!RES_HEADERS_TO_DROP.has(key)) res.setHeader(key, value);
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "proxy_failed",
      message: String((err && err.message) || err) }));
  }
};

module.exports.config = { api: { bodyParser: false }, maxDuration: 60 };

