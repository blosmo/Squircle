/** Works in browsers, React Native fetch environments, and Node. No developer credentials. */
export function createFeedback({ endpoint, token, fetcher = fetch }) {
  const base = new URL(endpoint);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw Error('Feedback requires HTTPS');
  async function call(path, body) {
    const response = await fetcher(new URL(path, base), {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error',
    });
    if (!response.ok) throw Error(`Feedback request rejected (${response.status})`);
    return response.json();
  }
  return {
    submit: report => call('/v1/feedback', report),
    status: id => call(`/v1/feedback/${encodeURIComponent(id)}`),
  };
}
