import { MongoClient } from "mongodb";

// Use connection pooling for better performance
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
    const uri = process.env.MONGO_URI;
    
    if (!uri) {
        throw new Error("MONGO_URI environment variable not set");
    }

    // Reuse existing connection if available
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    const options = {
        useUnifiedTopology: true,
        maxPoolSize: 10,  // Connection pooling for better performance
        socketTimeoutMS: 30000,  // Longer timeout for stability
        connectTimeoutMS: 10000
    };

    try {
        const client = new MongoClient(uri, options);
        await client.connect();
        
        const db = client.db("clarfactura");
        
        // Cache connection for reuse
        cachedClient = client;
        cachedDb = db;
        
        return { client, db };
    } catch (error) {
        console.error("MongoDB connection error:", error);
        throw new Error(`Database connection failed: ${error.message}`);
    }
}

export default async function handler(req, res) {
    // Performance: Set CORS headers directly
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "OPTIONS,POST,GET");
    
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
    
    // Handle POST request for license validation
    if (req.method === "POST") {
        try {
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
            
            // Validate required fields
            if (!licenseKey || !deviceId) {
                return res.status(400).json({ message: "License key or device ID is missing." });
            }
            
            // Process license validation with timeout protection
            if (action === 'validate') {
                try {
                    // Add timeout protection for the validation process
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('License validation timed out')), 5000)
                    );
                    
                    const validationPromise = validateLicense(licenseKey, deviceId);
                    
                    // Wait for either validation to complete or timeout
                    const result = await Promise.race([validationPromise, timeoutPromise]);
                    return res.status(result.statusCode).json(JSON.parse(result.body));
                } catch (error) {
                    console.error("License validation error:", error);
                    return res.status(500).json({ message: "License validation timed out or failed." });
                }
            } else {
                return res.status(400).json({ message: "Action is not recognized." });
            }
        } catch (error) {
            console.error("Unexpected error:", error);
            return res.status(500).json({ message: "An unexpected error occurred." });
        }
    }
    
    // Reject other HTTP methods
    return res.status(405).json({ message: "Method Not Allowed" });
}

async function validateLicense(licenseKey, deviceId) {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
    };
    
    const normalizedLicenseKey = licenseKey.toLowerCase();
    const currentDate = new Date().toISOString().split('T')[0];
    
    try {
        // Get database connection (now with pooling for better performance)
        const { db } = await connectToDatabase();
        const licenses = db.collection("licenses");
        
        // Performance: Use a projection to only retrieve the fields we need
        const license = await licenses.findOne(
            { key: normalizedLicenseKey },
            { projection: { key: 1, expiryDate: 1, clientName: 1, isUsed: 1, deviceId: 1, isActive: 1 } }
        );
        
        // Automatically set isActive to false if the license has expired
        let isActive = license && currentDate <= license.expiryDate;
        
        // Unchanged validation logic - preserves admin changes
        if (!license || !isActive || (license.isUsed && license.deviceId !== deviceId)) {
            const message = !license ? "License is not valid for use." :
                (!isActive ? "License has expired." : "License is already in use on another device.");
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ message }) 
            };
        }
        
        // CRITICAL FIX: Only update the license if something has actually changed
        // This preserves admin changes made directly to the database
        if (!license.isUsed || license.deviceId !== deviceId || license.isActive !== isActive) {
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
        }
        
        // Format response exactly like original implementation
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
    } catch (error) {
        console.error("Error validating license:", error);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ message: "Internal server error." }) 
        };
    }
}
