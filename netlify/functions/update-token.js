exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token) return { statusCode: 400, body: 'missing token' };
  
  const res = await fetch(`https://api.netlify.com/api/v1/sites/839aa6e8-1984-428d-8305-6cb55597be1d/env/GMAIL_REFRESH_TOKEN`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${process.env.NETLIFY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [{ value: token, context: 'all' }] })
  });
  const text = await res.text();
  return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: `Status: ${res.status}\n${text}` };
};
