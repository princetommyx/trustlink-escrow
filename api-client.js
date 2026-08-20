import { auth } from './firebase-config.js';

export const callApi = (functionName) => {
    return async (data) => {
        let headers = {
            'Content-Type': 'application/json'
        };

        if (auth.currentUser) {
            try {
                const token = await auth.currentUser.getIdToken();
                headers['Authorization'] = `Bearer ${token}`;
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

            const result = await response.json();
            
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
