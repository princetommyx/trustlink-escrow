import { auth } from './firebase-config.js';

export const callApi = (functionName) => {
    return async (data) => {
        let headers = {
            'Content-Type': 'application/json'
        };

        if (auth.currentUser) {
            try {
                const token = await auth.currentUser.getIdToken();
                headers['Authorization'] = `Bearer ${token.trim()}`;
            } catch (err) {
                console.warn('Failed to get auth token', err);
            }
        }

        try {
            const response = await fetch(`/api/core`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ action: functionName, data })
            });

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch (jsonErr) {
                throw new Error(`Server returned invalid JSON. Status: ${response.status}. Body: ${text.substring(0, 100)}...`);
            }
            
            if (!response.ok) {
                const errorMsg = result.error || 'API call failed';
                throw new Error(errorMsg);
            }

            return result;
        } catch (error) {
            console.error(`Error calling ${functionName}:`, error);
            throw error;
        }
    };
};
