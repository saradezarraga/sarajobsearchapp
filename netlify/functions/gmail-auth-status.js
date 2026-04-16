exports.handler = async () => {
  const connected = !!process.env.GMAIL_REFRESH_TOKEN;
  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ connected })
  };
};
