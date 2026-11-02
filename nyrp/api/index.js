const { handleRequest } = require("../server.js");

module.exports = async function vercelHandler(request, response) {
  const routedUrl = new URL(request.url || "/", "https://vercel.invalid");
  const routedPath = routedUrl.searchParams.get("__route");

  if (routedPath !== null) {
    routedUrl.searchParams.delete("__route");
    const pathname = routedPath.startsWith("/") ? routedPath : "/" + routedPath;
    request.url = pathname + routedUrl.search;
  }

  return handleRequest(request, response);
};

module.exports.config = { api: { bodyParser: false } };
