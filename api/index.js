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
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 30000,
    };

    try {
        const client = new MongoClient(uri, options);
        await client.connect();
        
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
    if (req.method === "GET") {
        return res.status(200).json({ 
            message: "License API is running",
            status: "online",
            timestamp: new Date().toISOString()
        });
    }
    
    if (req.method === "POST") {
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('MongoDB operation timed out')), 8000)
            );
            
            const licensePromise = processLicenseRequest(req, res);
            
            await Promise.race([licensePromise, timeoutPromise]);
            
            return;
        } catch (error) {
            console.error("Request processing error:", error);
            return res.status(500).json({ 
                message: "Error processing request", 
                error: error.message 
            });
        }
    }
    
    return res.status(405).json({ message: "Method Not Allowed" });
}

async function processLicenseRequest(req, res) {
    const { licenseKey, deviceId, action = "validate" } = req.body || {};
    
    if (!licenseKey || !deviceId) {
        return res.status(400).json({ message: "License key or device ID is missing." });
    }

    if (action === "validate") {
        return await validateLicense(licenseKey, deviceId, res);
    } else {
        return res.status(400).json({ message: "Action not recognized." });
    }
}

async function validateLicense(licenseKey, deviceId, res) {
    try {
        console.log("Connecting to database...");
        const { db } = await connectToDatabase();
        console.log("Connected to database");
        
        const licenses = db.collection("licenses");

        const normalizedLicenseKey = licenseKey.toLowerCase();
        const currentDate = new Date().toISOString().split("T")[0];

        console.log(`Finding license: ${normalizedLicenseKey}`);
        const license = await licenses.findOne({ key: normalizedLicenseKey });
        console.log("License found:", license ? "Yes" : "No");

        if (!license) {
            return res.status(400).json({ message: "License not found." });
        }

        let isActive = currentDate <= license.expiryDate;

        if (!isActive || (license.isUsed && license.deviceId !== deviceId)) {
            return res.status(400).json({
                message: isActive ? "License is already in use." : "License has expired."
            });
        }

        console.log("Updating license...");
        await licenses.updateOne(
            { key: normalizedLicenseKey },
            { $set: { isUsed: true, deviceId, isActive } }
        );
        console.log("License updated");

        return res.status(200).json({
            success: true,
            message: "License validated and associated with the device.",
            deviceId,
            clientName: license.clientName,
            expiryDate: license.expiryDate,
            isActive
        });
    } catch (error) {
        console.error("Error in validateLicense:", error);
        return res.status(500).json({ 
            message: "Error validating license", 
            error: error.message 
        });
    }
}