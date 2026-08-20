export default async (req, res) => {
    try {
        const corsModule = await import('cors');
        return res.status(200).json({ ok: true, typeofCors: typeof corsModule });
    } catch (e) {
        return res.status(200).json({ ok: false, error: e.message, stack: e.stack });
    }
};
