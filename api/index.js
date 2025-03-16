import { MongoClient } from "mongodb";

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
    const uri = process.env.MONGO_URI;
    
    if (!uri) {
        throw new Error("MONGO_URI environment variable not set");
    }

    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    const options = {
        useUnifiedTopology: true
    };

    try {
        const client = new MongoClient(uri, options);
        await client.connect();
        
        // Change this to your actual database name
        const db = client.db("test");
        
        cachedClient = client;
        cachedDb = db;
        
        return { client, db };
    } catch (error) {
        console.error("MongoDB connection error:", error);
        throw new Error(`Database connection failed: ${error.message}`);
    }
}

export default async function handler(req, res) {
    // Set CORS headers
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
    
    // Handle GET request - status check
    if (req.method === "GET") {
        return res.status(200).json({ 
            message: "License API is running",
            status: "online",
            timestamp: new Date().toISOString()
        });
    }
    
    // Handle POST request for license validation
    if (req.method === "POST") {
        let requestBody = req.body;
        
        // Parse JSON if needed (depends on how Vercel handles body parsing)
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
        
        // Process license validation
        if (action === 'validate') {
            return await validateLicense(licenseKey, deviceId, res);
        } else {
            return res.status(400).json({ message: "Action is not recognized." });
        }
    }
    
    // Reject other HTTP methods
    return res.status(405).json({ message: "Method Not Allowed" });
}

async function validateLicense(licenseKey, deviceId, res) {
    const normalizedLicenseKey = licenseKey.toLowerCase();
    const currentDate = new Date().toISOString().split('T')[0];
    
    try {
        // Connect to database
        const { db } = await connectToDatabase();
        
        // Get licenses collection
        const licenses = db.collection("licenses");
        
        // Find license by key
        const license = await licenses.findOne({ key: normalizedLicenseKey });
        
        // Automatically set isActive to false if the license has expired
        let isActive = license && currentDate <= license.expiryDate;
        
        // Check if the license does not exist, has expired, or is already used on another device
        if (!license || !isActive || (license.isUsed && license.deviceId !== deviceId)) {
            const message = !license ? "License is not valid for use." :
                (!isActive ? "License has expired." : "License is already in use on another device.");
            return res.status(400).json({ message });
        }
        
        // Proceed to mark the license as used and associate it with the deviceId
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
        
        // Return success response
        return res.status(200).json({ 
            success: true, 
            message: "License has been validated and associated with the device.", 
            deviceId: deviceId, 
            clientName: license.clientName, 
            expiryDate: license.expiryDate, 
            isActive 
        });
        
    } catch (error) {
        console.error("Error validating and updating license: ", error);
        return res.status(500).json({ message: "Internal server error." });
    }
}
