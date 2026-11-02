// Vercel detects this Node.js server entry point. Keep the same HTTP server
// for local npm start and run the weekly reset through Vercel Cron in production.
const { startServer } = require("./server.js");

startServer(Number(process.env.PORT || 3000));
