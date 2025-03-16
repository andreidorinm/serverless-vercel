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
        useUnifiedTopology: true,
        maxPoolSize: 10  
    };

    try {
        const client = new MongoClient(uri, options);
        await client.connect();
        
        const db = client.db("clarfactura");
        
        cachedClient = client;
        cachedDb = db;
        
        return { client, db };
    } catch (error) {
        console.error("MongoDB connection error:", error);
        throw new Error(`Database connection failed: ${error.message}`);
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST,GET');
    
    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }
    
    if (req.method === "GET") {
        return res.status(200).json({ 
            success: true,
            message: "License API is running",
            status: "online",
            timestamp: new Date().toISOString()
        });
    }
    
    if (req.method === "POST") {
        try {
            let requestBody = req.body;
            
            console.log("Request body received:", JSON.stringify(requestBody));
            
            if (typeof requestBody === 'string') {
                try {
                    requestBody = JSON.parse(requestBody);
                } catch (error) {
                    console.error("JSON parsing error:", error);
                    return res.status(400).json({ 
                        success: false, 
                        message: "Body is not valid JSON." 
                    });
                }
            }
            
            if (!requestBody) {
                console.error("Empty request body");
                return res.status(400).json({ 
                    success: false, 
                    message: "Request body is empty." 
                });
            }
            
            const { licenseKey, deviceId, action = 'validate' } = requestBody;
            
            console.log("Extracted values:", { licenseKey, deviceId, action });
            
            if (!licenseKey || !deviceId) {
                const missingFields = [];
                if (!licenseKey) missingFields.push("licenseKey");
                if (!deviceId) missingFields.push("deviceId");
                
                console.error("Missing required fields:", missingFields);
                return res.status(400).json({ 
                    success: false, 
                    message: `Required fields missing: ${missingFields.join(", ")}` 
                });
            }
            
            if (action === 'validate') {
                return await validateLicense(licenseKey, deviceId, res);
            } else {
                return res.status(400).json({ 
                    success: false, 
                    message: "Action is not recognized." 
                });
            }
        } catch (error) {
            console.error("Unexpected error processing request:", error);
            return res.status(500).json({ 
                success: false, 
                message: "An unexpected error occurred." 
            });
        }
    }
    
    return res.status(405).json({ 
        success: false, 
        message: "Method Not Allowed" 
    });
}

async function validateLicense(licenseKey, deviceId, res) {
    const normalizedLicenseKey = licenseKey.toLowerCase();
    const currentDate = new Date().toISOString().split('T')[0];
    
    console.log(`Validating license: ${normalizedLicenseKey} for device: ${deviceId}`);
    
    try {
        console.log("Connecting to MongoDB...");
        const dbPromise = connectToDatabase();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('MongoDB connection timed out')), 5000)
        );
        
        const { db } = await Promise.race([dbPromise, timeoutPromise]);
        console.log("Connected to MongoDB successfully");
        
        const licenses = db.collection("licenses");
        
        console.log("Finding license in database with key:", normalizedLicenseKey);
        const license = await licenses.findOne({ key: normalizedLicenseKey });
        console.log("License found:", license ? "Yes" : "No");
        
        if (!license) {
            console.log("License not found in database");
            return res.status(400).json({ 
                success: false, 
                message: "License is not valid for use." 
            });
        }
        
        let isActive = currentDate <= license.expiryDate;
        console.log("License active status:", isActive, "Expiry date:", license.expiryDate);
        
        if (!isActive) {
            console.log("License has expired");
            return res.status(400).json({ 
                success: false, 
                message: "License has expired." 
            });
        }
        
        if (license.isUsed && license.deviceId !== deviceId) {
            console.log("License already in use on device:", license.deviceId);
            return res.status(400).json({ 
                success: false, 
                message: "License is already in use on another device." 
            });
        }
        
        console.log("Updating license with device ID:", deviceId);
        await licenses.updateOne(
            { key: normalizedLicenseKey },
            { 
                $set: { 
                    isUsed: true, 
                    deviceId: deviceId, 
                    isActive: isActive,
                    lastValidated: new Date().toISOString()
                }
            }
        );
        
        console.log("License validation successful");
        
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
        return res.status(500).json({ 
            success: false, 
            message: "Internal server error during license validation." 
        });
    }
}
