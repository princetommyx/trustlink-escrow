export default async (req, res) => {
    try {
        const core = await import('./core.js');
        return await core.default(req, res);
    } catch (e) {
        return res.status(200).json({ ok: false, error: e.message, stack: e.stack });
    }
};
