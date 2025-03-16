import { MongoClient } from "mongodb";

// No cached connection - create a new connection for each request
async function connectToDatabase() {
    const uri = process.env.MONGO_URI;
    
    if (!uri) {
        throw new Error("MONGO_URI environment variable not set");
    }

    try {
        const client = new MongoClient(uri, { useUnifiedTopology: true });
        await client.connect();
        const db = client.db("clarfactura");
        return { client, db };
    } catch (error) {
        console.error("MongoDB connection error:", error);
        throw new Error(`Database connection failed: ${error.message}`);
    }
}

export default async function handler(req, res) {
    // Set CORS headers - matching exactly with original DynamoDB implementation
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
    };
    
    // Apply CORS headers to response
    Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value);
    });
    
    // Handle preflight OPTIONS request
    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }
    
    // Handle GET request
    if (req.method === "GET") {
        return res.status(200).json({ 
            success: true,
            message: "License API is running",
            status: "online",
            timestamp: new Date().toISOString()
        });
    }
    
    // Handle POST request for license validation - matching original logic exactly
    if (req.method === "POST") {
        let requestBody = req.body;
        
        // Parse JSON if needed
        if (typeof requestBody === 'string') {
            try {
                requestBody = JSON.parse(requestBody);
            } catch (error) {
                return res.status(400).json({ message: "Body is not valid JSON." });
            }
        }
        
        const { licenseKey, deviceId, action = 'validate' } = requestBody || {};
        
        // Validate required fields - exact same check as DynamoDB
        if (!licenseKey || !deviceId) {
            return res.status(400).json({ message: "License key or device ID is missing." });
        }
        
        // Process license validation
        if (action === 'validate') {
            const result = await validateLicense(licenseKey, deviceId);
            return res.status(result.statusCode).json(JSON.parse(result.body));
        } else {
            return res.status(400).json({ message: "Action is not recognized." });
        }
    }
    
    // Reject other HTTP methods
    return res.status(405).json({ message: "Method Not Allowed" });
}

// Function rewritten to match DynamoDB implementation exactly
async function validateLicense(licenseKey, deviceId) {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
    };
    
    const normalizedLicenseKey = licenseKey.toLowerCase();
    const currentDate = new Date().toISOString().split('T')[0];
    
    try {
        // Create a new connection for each request (no caching)
        const { client, db } = await connectToDatabase();
        
        try {
            const licenses = db.collection("licenses");
            
            // Find license by key - equivalent to GetCommand
            const license = await licenses.findOne({ key: normalizedLicenseKey });
            
            // Automatically set isActive to false if the license has expired
            let isActive = license && currentDate <= license.expiryDate;
            
            // Combined check exactly matching the DynamoDB implementation
            if (!license || !isActive || (license.isUsed && license.deviceId !== deviceId)) {
                const message = !license ? "License is not valid for use." :
                    (!isActive ? "License has expired." : "License is already in use on another device.");
                return { 
                    statusCode: 400, 
                    headers, 
                    body: JSON.stringify({ message }) 
                };
            }
            
            // Update license - exactly matching DynamoDB update
            await licenses.updateOne(
                { key: normalizedLicenseKey },
                { 
                    $set: { 
                        isUsed: true, 
                        deviceId: deviceId, 
                        isActive: isActive 
                    }
                }
            );
            
            // Format response exactly like DynamoDB implementation
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    success: true, 
                    message: "License has been validated and associated with the device.", 
                    deviceId: deviceId, 
                    clientName: license.clientName, 
                    expiryDate: license.expiryDate, 
                    isActive 
                }) 
            };
        } finally {
            // Always close the connection
            await client.close();
        }
    } catch (error) {
        console.error("Error validating and updating license: ", error);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ message: "Internal server error." }) 
        };
    }
}
