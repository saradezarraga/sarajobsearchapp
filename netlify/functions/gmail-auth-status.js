const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  try {
    const store = getStore('gmail-auth');
    const token = await store.get('refresh_token');
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ connected: !!token })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ connected: false })
    };
  }
};
