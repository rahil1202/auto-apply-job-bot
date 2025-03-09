import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CONFIG = {
    AMAZON_JOBS_URL: "https://hiring.amazon.com/app#/jobSearch",
    TARGET_JOBS: [
        "Delivery Station Warehouse Associate",
        "Fulfilment Station Warehouse Associate"
    ],
    USER_DATA_DIR: path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data'),
    CHROME_PROFILES: [
        "Profile 11",
        "Profile 12", 
        "Profile 13"        
    ],
    REFRESH_INTERVAL: 30000
};