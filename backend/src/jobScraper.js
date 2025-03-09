export const scrapeJobs = async (page) => {
    await page.waitForSelector('.hvh-careers-emotion-1pll7m0', { 
        timeout: 20000 
    });

    // Get the index of each job element as well
    return await page.evaluate(() => {
        const jobElements = document.querySelectorAll('.hvh-careers-emotion-1pll7m0');
        return Array.from(jobElements).map((job, index) => {
            const titleText = job.innerText || job.textContent;
            const linkElement = job.closest('a');
            return {
                title: titleText?.trim() || "No Title",
                link: linkElement?.href || null,
                index: index // Store the index for later use
            };
        });
    });
};

export const isTargetJob = (jobTitle, targetJobs) => {
    return targetJobs.some(targetJob => 
        jobTitle.toLowerCase().includes(targetJob.toLowerCase())
    );
};