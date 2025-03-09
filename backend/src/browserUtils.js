import fs from 'fs/promises';

export const findChromePath = async () => {
    const commonPaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
    ];

    for (const path of commonPaths) {
        try {
            await fs.access(path);
            return path;
        } catch {
            continue;
        }
    }
    
    throw new Error('Chrome not found! Please install Chrome or provide the correct path.');
};
