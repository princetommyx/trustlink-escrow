import twilio from 'twilio';
export default async (req, res) => {
    return res.status(200).json({ ok: true, typeofTwilio: typeof twilio });
};
