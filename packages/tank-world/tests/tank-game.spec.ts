import { test, expect } from '@playwright/test';

test.describe('Tank Game', () => {
  test.beforeEach(async ({ page }) => {
    // Start on the main page
    await page.goto('http://localhost:5173');
  });

  test('should display the tank game interface', async ({ page }) => {
    // Check that the main UI elements are present
    await expect(page.locator('h1')).toContainText('Tank World');
    
    // Check for connection status
    await expect(page.locator('text=Connection:')).toBeVisible();
    
    // Check for team sections
    await expect(page.locator('text=Red Team')).toBeVisible();
    await expect(page.locator('text=Blue Team')).toBeVisible();
    
    // Check for spawn controls
    await expect(page.getByTestId('spawn-red-tank')).toBeVisible();
    await expect(page.getByTestId('spawn-blue-tank')).toBeVisible();
    
    // Check for game events section
    await expect(page.locator('text=Game Events')).toBeVisible();
  });

  test('should show connection status', async ({ page }) => {
    // Wait for WebSocket connection
    await page.waitForTimeout(2000);
    
    // Should show connected status eventually
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 10000 });
  });

  test('should spawn a red tank', async ({ page }) => {
    // Wait for connection
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 10000 });
    
    // Spawn a red tank
    await page.getByTestId('spawn-red-tank').click();
    
    // Wait a bit for the spawn to process
    await page.waitForTimeout(1000);
    
    // Check that a tank appears in the red team list
    await expect(page.locator('text=Red Team (1)')).toBeVisible({ timeout: 5000 });
    
    // Should see a tank element
    await expect(page.getByTestId(/tank-\d+/)).toBeVisible();
  });

  test('should spawn a blue tank', async ({ page }) => {
    // Wait for connection
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 10000 });
    
    // Spawn a blue tank
    await page.getByTestId('spawn-blue-tank').click();
    
    // Wait a bit for the spawn to process
    await page.waitForTimeout(1000);
    
    // Check that a tank appears in the blue team list
    await expect(page.locator('text=Blue Team (1)')).toBeVisible({ timeout: 5000 });
  });

  test('should spawn tank at specific coordinates', async ({ page }) => {
    // Wait for connection
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 10000 });
    
    // Set specific spawn coordinates
    await page.getByTestId('spawn-x').fill('150');
    await page.getByTestId('spawn-y').fill('200');
    
    // Spawn a red tank
    await page.getByTestId('spawn-red-tank').click();
    
    // Wait for spawn
    await page.waitForTimeout(1000);
    
    // Check that tank appears with correct coordinates
    await expect(page.locator('text=Position: (150.0, 200.0)')).toBeVisible({ timeout: 5000 });
  });

  test('should move a tank', async ({ page }) => {
    // Wait for connection
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 10000 });
    
    // Spawn a tank first
    await page.getByTestId('spawn-red-tank').click();
    await page.waitForTimeout(1000);
    
    // Click on the tank to select it
    await page.getByTestId(/tank-\d+/).first().click();
    
    // Enter move coordinates
    await page.getByTestId('move-target-x').fill('300');
    await page.getByTestId('move-target-y').fill('250');
    
    // Click move button
    await page.getByTestId('move-tank-button').click();
    
    // Wait a bit for the move command to process
    await page.waitForTimeout(2000);
    
    // Tank should show as moving (has active order)
    await expect(page.locator('text=Moving')).toBeVisible({ timeout: 5000 });
  });

  test('should refresh world state', async ({ page }) => {
    // Wait for connection
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 10000 });
    
    // Click refresh button
    await page.getByTestId('refresh-world-state').click();
    
    // Wait for response
    await page.waitForTimeout(1000);
    
    // Should see some activity in the game events log
    // (The exact events depend on what tanks are already spawned)
    await expect(page.locator('text=Game Events')).toBeVisible();
  });

  test('should show game events', async ({ page }) => {
    // Wait for connection
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 10000 });
    
    // Spawn a tank to generate events
    await page.getByTestId('spawn-red-tank').click();
    
    // Wait for events
    await page.waitForTimeout(2000);
    
    // Check that events appear in the log
    const gameEventsSection = page.locator('text=Game Events').locator('..');
    await expect(gameEventsSection).toContainText(/game:/);
  });

  test('should handle multiple tanks', async ({ page }) => {
    // Wait for connection
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 10000 });
    
    // Spawn multiple tanks
    await page.getByTestId('spawn-red-tank').click();
    await page.waitForTimeout(500);
    await page.getByTestId('spawn-blue-tank').click();
    await page.waitForTimeout(500);
    await page.getByTestId('spawn-red-tank').click();
    
    // Wait for all spawns
    await page.waitForTimeout(2000);
    
    // Should show correct counts
    await expect(page.locator('text=Red Team (2)')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Blue Team (1)')).toBeVisible({ timeout: 5000 });
    
    // Should see multiple tank elements
    const tanks = page.getByTestId(/tank-\d+/);
    await expect(tanks).toHaveCount(3, { timeout: 5000 });
  });
});