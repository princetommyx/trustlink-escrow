export default async (req, res) => {
    try {
        const fbModule = await import('firebase-admin');
        const admin = fbModule.default || fbModule;
        return res.status(200).json({ ok: true, typeofAdmin: typeof admin, keys: Object.keys(admin) });
    } catch (e) {
        return res.status(200).json({ ok: false, error: e.message, stack: e.stack });
    }
};
