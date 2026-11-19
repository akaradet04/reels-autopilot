/**
 * Ask GitHub to start a worker run now instead of waiting for the next 30-minute tick.
 * Optional: without GITHUB_DISPATCH_TOKEN the change simply waits for the next tick.
 */
export async function runWorkerNow(): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return false;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/worker.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME || "main" }),
  });
  return res.status === 204;
}
