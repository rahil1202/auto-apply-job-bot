import puppeteer from 'puppeteer';
import { findChromePath } from './browserUtils.js';
import { scrapeJobs, isTargetJob } from './jobScraper.js';

// State variables
let isRunning = false;
let keepBrowserOpen = false;
let currentProfileIndex = 0;
let currentConfig = null;
let activeBrowser = null;

// Check if monitoring is running
export const isJobMonitorRunning = () => isRunning;

// Get current configuration
export const getCurrentConfig = () => currentConfig;

// Start job monitoring
export const startMonitoringJobs = async (config, logCallback) => {
    if (isRunning) {
        throw new Error("Job monitoring is already running");
    }
    
    isRunning = true;
    currentConfig = config;
    
    try {
        await monitorJobs(config, logCallback);
    } catch (error) {
        console.error("Error in job monitoring:", error);
    } finally {
        isRunning = false;
    }
};

// Stop job monitoring
export const stopMonitoringJobs = () => {
    isRunning = false;
    keepBrowserOpen = false;
    
    // Close browser if it's open
    if (activeBrowser) {
        try {
            activeBrowser.close();
        } catch (error) {
            console.error("Error closing browser:", error);
        }
        activeBrowser = null;
    }
    
    return true;
};

// Main monitoring function
const monitorJobs = async (config, logCallback) => {
    console.log("🚀 Starting Amazon Jobs Monitor...");
    console.log("Looking for the following positions:");
    config.TARGET_JOBS.forEach(job => console.log(`- ${job}`));
    
    const chromePath = await findChromePath();
    console.log(`Using Chrome from: ${chromePath}`);

    // Get current profile to use
    const profileToUse = config.CHROME_PROFILES[currentProfileIndex];
    
    // Update index for next run (cycle through profiles)
    currentProfileIndex = (currentProfileIndex + 1) % config.CHROME_PROFILES.length;
    
    console.log(`Using Chrome profile: ${profileToUse}`);

    try {
        activeBrowser = await launchBrowser(chromePath, profileToUse, config);
        const page = await setupPage(activeBrowser);
        
        // Main job monitoring loop
        while (isRunning) {
            try {
                const success = await checkForJobs(page, config);
                if (success) {
                    keepBrowserOpen = true; // Set flag to keep browser open
                    console.log("✅ Application process initiated successfully. Browser will remain open.");
                    return; // Exit the function but don't close browser
                }
                
                // If we reach here, no application was successful
                await waitRandomTime(config.REFRESH_INTERVAL, 5000, "Waiting to retry");
                
            } catch (error) {
                console.error("Error during job search:", error.message);
                await new Promise(resolve => setTimeout(resolve, 60000));
            }
        }
    } catch (error) {
        console.error("Fatal error:", error);
    } finally {
        // Only close browser if the keepBrowserOpen flag is false
        if (activeBrowser && !keepBrowserOpen) {
            await activeBrowser.close();
            console.log("Browser closed");
            activeBrowser = null;
        } else if (keepBrowserOpen) {
            console.log("Browser remains open for user interaction");
        }
        isRunning = false;
    }
};

async function launchBrowser(chromePath, profileToUse, config) {
    return await puppeteer.launch({
        headless: false,
        executablePath: chromePath,
        defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--start-maximized',
            `--user-data-dir=${config.USER_DATA_DIR}`,
            `--profile-directory=${profileToUse}`
        ]
    });
}

async function setupPage(browser) {
    const page = await browser.newPage();
    
    // Set a more recent user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    
    // Add anti-detection measures
    await page.evaluateOnNewDocument(() => {
        // Override the navigator.webdriver property to prevent detection
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false
        });
    });
    
    return page;
}

async function checkForJobs(page, config) {
    console.log("\n🔍 Checking for ```" + config.TARGET_JOBS.join("```, ```") + "``` positions...");
    
    // Add a random delay to mimic human behavior
    await waitRandomTime(5000, 1000);
    
    await page.goto(config.AMAZON_JOBS_URL, { 
        waitUntil: "domcontentloaded",
        timeout: 60000 
    });
    
    // Wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 3000));

    const jobs = await scrapeJobs(page);
    console.log(`Found ${jobs.length} total positions`);
    
    const matchingJobs = jobs.filter(job => isTargetJob(job.title, config.TARGET_JOBS));

    if (matchingJobs.length > 0) {
        console.log(`✅ Found ${matchingJobs.length} matching positions!`);
        
        for (const job of matchingJobs) {
            const success = await processJob(page, job, config);
            if (success) {
                return true; // Application successful
            }
        }
    } else {
        console.log("❌ No matching positions found");
    }
    
    return false; // No successful applications
}

async function processJob(page, job, config) {
    console.log(`Processing: ${job.title}`);
    
    // Add random delay between processing jobs
    await waitRandomTime(5000, 5000, "Waiting before next job");
    
    // Find and click on the job element
    const jobElements = await page.$$('.hvh-careers-emotion-1pll7m0');
    if (jobElements.length <= job.index) {
        console.error(`Could not find element for job index ${job.index}`);
        return false;
    }
    
    console.log(`Found ${jobElements.length} job elements, clicking on element at index ${job.index}`);
    
    try {
        // Click job and wait for navigation
        await navigateToJobDetails(page, jobElements[job.index]);
        
        // Verify we're on the job details page
        const onJobPage = await verifyJobDetailsPage(page);
        if (!onJobPage) {
            console.log("Not on job details page - returning to search");
            await navigateBack(page, config.AMAZON_JOBS_URL);
            return false;
        }
        
        // Handle shift selection
        await handleShiftSelection(page);
        
        // Look for and click apply button
        const applied = await clickApplyButton(page);
        if (applied) {
            console.log("✅ Application process initiated successfully");
            await page.screenshot({ path: `successful-apply-${Date.now()}.png` });
            
            // Wait a moment to ensure new tab opens
            await new Promise(resolve => setTimeout(resolve, 10000));
            return true; // Successful application
        }
        
    } catch (error) {
        console.error(`Error processing job: ${error.message}`);
    }
    
    // Return to search results if needed
    await navigateBack(page, config.AMAZON_JOBS_URL);
    return false;
}

async function navigateToJobDetails(page, jobElement) {
    console.log("Clicking job and waiting for navigation...");
    
    try {
        // Use Promise.all to handle both click and navigation
        await Promise.all([
            // This waits for navigation with a less strict condition
            page.waitForNavigation({ 
                timeout: 30000, 
                waitUntil: "domcontentloaded" 
            }).catch(err => {
                console.log("Navigation timeout, but proceeding anyway...");
            }),
            // This clicks the job element
            jobElement.click()
        ]);
        
        console.log("Navigation completed");
    } catch (clickError) {
        console.error(`Error during click and navigation: ${clickError.message}`);
    }
    
    // Give the page some time to settle
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Log the current URL to help with debugging
    const currentUrl = await page.url();
    console.log(`Current page URL: ${currentUrl}`);
}

async function verifyJobDetailsPage(page) {
    console.log("Checking if we're on the job details page...");
    const onJobPage = await page.evaluate(() => {
        return !!document.querySelector('#jobDetailApplyButtonDesktop') || 
            !!document.querySelector('.jobDetailScheduleDropdown') ||
            !!document.querySelector('[data-testid="job-detail-apply-button"]') ||
            document.title.includes('Job Details');
    });
    
    if (onJobPage) {
        console.log("Successfully navigated to job details page");
        return true;
    } else {
        console.log("May not be on job details page");
        // Wait a bit longer in case page is still loading
        await new Promise(resolve => setTimeout(resolve, 5000));
        return false;
    }
}

async function handleShiftSelection(page) {
    console.log("Looking for shift selection dropdown...");
    
    // Check if shift selection is present before interacting
    const hasShiftDropdown = await page.evaluate(() => {
        // Look for different possible selectors for the dropdown
        const selectors = [
            '.jobDetailScheduleDropdown.hvh-careers-emotion-1uzwmf0',
            '.jobDetailScheduleDropdown',
            '[data-testid="shift-preference-dropdown"]',
            'select[name="shift"]',
            '[aria-label="Select shift"]',
            '.scheduleFlyoutSelection',
            '.hvh-careers-emotion-wp352q'
        ];
        
        for (const selector of selectors) {
            if (document.querySelector(selector)) {
                return selector;
            }
        }
        return null;
    });
    
    if (!hasShiftDropdown) {
        console.log("No shift dropdown found. Will proceed directly to apply button...");
        return;
    }
    
    console.log(`Shift dropdown found with selector: ${hasShiftDropdown}`);
    // Wait a moment before interacting
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    try {
        await page.click(hasShiftDropdown);
        await new Promise(resolve => setTimeout(resolve, 4000));                                     
       
        // Look for dropdown options
        console.log("Looking for shift options...");
        const optionsExist = await findShiftOptions(page);
        
        if (optionsExist) {
            console.log(`Found ${optionsExist.count} shift options with selector: ${optionsExist.selector}`);
            
            // Click the first option
            await page.click(`${optionsExist.selector}:first-of-type`);
            console.log("Clicked first shift option");
            
            // Give it a moment to register the selection
            await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
            console.log("Could not find shift options. Trying direct approach...");
            
            // Try a more direct approach
            await clickFirstAvailableShift(page);
            
            // Wait for selection to register
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } catch (dropdownError) {
        console.error(`Error interacting with dropdown: ${dropdownError.message}`);
    }
}

async function findShiftOptions(page) {
    return await page.evaluate(() => {
        // First try the specific selector structure from screenshot
        const shiftItems = document.querySelectorAll('.hvh-careers-emotion-1ewhhfh');
        if (shiftItems && shiftItems.length > 0) {
            return { selector: '.hvh-careers-emotion-1ewhhfh', count: shiftItems.length };
        }
        
        // Alternative: try getting the first shift container
        const shiftContainer = document.querySelector('.hvh-careers-emotion-15qbkvn');
        if (shiftContainer) {
            // Get the first clickable child element
            const firstShift = shiftContainer.querySelector('div[role="button"]') || 
                            shiftContainer.querySelector('div.pointer') ||
                            shiftContainer.firstElementChild;
            
            if (firstShift) {
                // Add a data attribute so we can select it
                firstShift.setAttribute('data-first-shift', 'true');
                return { selector: '[data-first-shift="true"]', count: 1 };
            }
        }
        
        // Fallback to other selectors
        const optionSelectors = [
            'option',
            'li[role="option"]',
            '[role="option"]',
            '.dropdown-item',
            'div[role="button"]',
            '.pointer'
        ];
        
        for (const selector of optionSelectors) {
            const options = document.querySelectorAll(selector);
            if (options.length > 0) {
                return { selector, count: options.length };
            }
        }
        
        return null;
    });
}

async function clickFirstAvailableShift(page) {
    await page.evaluate(() => {
        // Try to find and click the first shift item by looking at the DOM structure
        const shiftItems = document.querySelectorAll('div.pointer');
        if (shiftItems && shiftItems.length > 0) {
            shiftItems[0].click();
            return true;
        }
        
        // Another approach - find anything that looks like a shift item
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
            if (div.innerText && div.innerText.includes('Flexible Shifts')) {
                div.click();
                return true;
            }
        }
        
        return false;
    });
}

async function clickApplyButton(page) {
    console.log("Looking for apply button...");
    const applyButtonSelector = await findApplyButton(page);
    
    if (!applyButtonSelector) {
        console.log("No apply button found. Taking screenshot and searching page content...");
        
        // Try a different approach - look at page text
        const pageHasApplyText = await page.evaluate(() => {
            return document.body.innerText.toLowerCase().includes('apply');
        });
        
        if (pageHasApplyText) {
            console.log("Page contains 'apply' text but button not found with selectors.");
        }
        
        return false;
    }
    
    console.log(`Apply button found with selector: ${applyButtonSelector}`);
    
    // Wait a moment before clicking
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
        // Click the apply button, opening in new tab
        await page.evaluate((selector) => {
            const applyButton = document.querySelector(selector);
            if (applyButton) {
                // Ensure it opens in a new tab
                applyButton.setAttribute('target', '_blank');
                applyButton.click();
            }
        }, applyButtonSelector);
        
        console.log("✅ Apply button clicked successfully!");
        return true;
        
    } catch (applyError) {
        console.error(`Error clicking apply button: ${applyError.message}`);
        return false;
    }
}

async function findApplyButton(page) {
    return await page.evaluate(() => {
        // Check multiple possible selectors
        const buttonSelectors = [
            '#jobDetailApplyButtonDesktop',
            '[data-testid="job-detail-apply-button"]',
            'a.apply-button',
            'button.apply-button',
            'a[href*="apply"]',
            '.hvh-careers-emotion-[class*="applyButton"]'
        ];
        
        for (const selector of buttonSelectors) {
            try {
                const button = document.querySelector(selector);
                if (button) {
                    return selector;
                }
            } catch (e) {
                // Ignore errors from invalid selectors
            }
        }
        
        // Look for buttons with "Apply" text
        const buttons = Array.from(document.querySelectorAll('button, a.button, a.btn'));
        for (const button of buttons) {
            if (button.innerText.toLowerCase().includes('apply')) {
                // Return an identifier we can use to find this element
                button.setAttribute('data-test-apply-button', 'true');
                return '[data-test-apply-button="true"]';
            }
        }
        
        return null;
    });
}

async function navigateBack(page, fallbackUrl) {
    console.log("Returning to search results...");
    try {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 30000 });
        // Wait for the search page to load
        await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (backError) {
        console.error(`Error going back: ${backError.message}`);
        // If going back fails, navigate to the search URL again
        await page.goto(fallbackUrl, { 
            waitUntil: "domcontentloaded",
            timeout: 60000 
        });
        // Wait for the search page to load
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

async function waitRandomTime(baseMs, randomMs, message = null) {
    const delay = Math.floor(Math.random() * randomMs) + baseMs;
    if (message) {
        console.log(`${message}: ${delay}ms`);
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    return delay;
}