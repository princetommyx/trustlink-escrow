import cors from 'cors';
export default async (req, res) => {
    return res.status(200).json({ ok: true, typeofCors: typeof cors });
};
