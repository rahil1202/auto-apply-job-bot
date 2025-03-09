export const applyForJob = async (browser, job) => {
    console.log(`\n📝 Attempting to apply for: ${job.title}`);
    
    const page = await browser.newPage();
    try {
        await page.goto(job.link, { waitUntil: "networkidle0" });
        
        await page.waitForSelector(".apply-now", { timeout: 30000 });
        await page.click(".apply-now");
        await page.waitForNavigation({ waitUntil: "networkidle0" });
        
        console.log("✅ Application submitted successfully!");
        
    } catch (error) {
        console.error(`❌ Failed to apply for ${job.title}:`, error.message);
    } finally {
        await page.close();
    }
};