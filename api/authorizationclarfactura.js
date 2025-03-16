import { MongoClient } from "mongodb";

// Connection caching for serverless functions
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
    const uri = process.env.MONGO_URI;
    
    if (!uri) {
        throw new Error("MONGO_URI environment variable not set");
    }

    // Use cached connection if available
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    try {
        const client = new MongoClient(uri);
        await client.connect();
        
        const db = client.db("test");
        
        // Cache the connection
        cachedClient = client;
        cachedDb = db;
        
        return { client, db };
    } catch (error) {
        console.error("MongoDB connection error:", error);
        throw error;
    }
}

export default async function handler(req, res) {
    // Vercel automatically parses JSON bodies
    if (req.method !== "POST") {
        return res.status(405).json({ message: "Method Not Allowed" });
    }

    // Use req.body directly without parsing
    const { licenseKey, deviceId, action = "validate" } = req.body || {};
    
    if (!licenseKey || !deviceId) {
        return res.status(400).json({ message: "License key or device ID is missing." });
    }

    try {
        if (action === "validate") {
            return await validateLicense(licenseKey, deviceId, res);
        } else {
            return res.status(400).json({ message: "Action not recognized." });
        }
    } catch (error) {
        console.error("Error processing request:", error);
        return res.status(500).json({ 
            message: "Internal server error.", 
            error: error.message 
        });
    }
}

async function validateLicense(licenseKey, deviceId, res) {
    try {
        const { db } = await connectToDatabase();
        const licenses = db.collection("licenses");

        const normalizedLicenseKey = licenseKey.toLowerCase();
        const currentDate = new Date().toISOString().split("T")[0];

        console.log(`Validating license: ${normalizedLicenseKey} for device: ${deviceId}`);
        
        const license = await licenses.findOne({ key: normalizedLicenseKey });
        console.log("License found:", license ? "Yes" : "No");

        if (!license) {
            return res.status(400).json({ message: "License not found." });
        }

        let isActive = currentDate <= license.expiryDate;
        console.log(`License status: ${isActive ? "Active" : "Expired"}`);

        if (!isActive || (license.isUsed && license.deviceId !== deviceId)) {
            return res.status(400).json({
                message: isActive ? "License is already in use." : "License has expired."
            });
        }

        await licenses.updateOne(
            { key: normalizedLicenseKey },
            { $set: { isUsed: true, deviceId, isActive } }
        );

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