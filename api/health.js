module.exports.config = { runtime: 'nodejs20.x' };

module.exports = async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, ts: Date.now() });
};