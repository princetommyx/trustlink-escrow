// test-moolre.mjs
// Safe, offline unit test module for Moolre data structures.

export function validateMoolrePayload(amount, description, customerRef) {
    if (!amount || parseFloat(amount) <= 0) {
        return { valid: false, error: "Invalid amount" };
    }
    if (!description) {
        return { valid: false, error: "Missing description" };
    }
    return {
        valid: true,
        payload: {
            amount: parseFloat(amount).toFixed(2),
            currency: "GHS",
            ref: customerRef || `REF-${Date.now()}`
        }
    };
}

// Deterministic test runner
if (process.argv[1] && process.argv[1].endsWith('test-moolre.mjs')) {
    console.log("=== Moolre Data Schema Validation ===");
    const res = validateMoolrePayload(100.5, "Test Order", "ORDER-001");
    if (res.valid) {
        console.log("✅ Schema validation successful:", res.payload);
    } else {
        console.error("❌ Schema validation failed:", res.error);
        process.exit(1);
    }
}
