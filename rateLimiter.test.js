import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowLimiter } from './rateLimiter.js';

describe('SlidingWindowLimiter', () => {
  it('should allow up to maxRequests and then block', () => {
    const limiter = new SlidingWindowLimiter({ maxRequests: 3, windowMs: 1000 });
    
    assert.strictEqual(limiter.allow('user1', 1000), true);
    assert.strictEqual(limiter.allow('user1', 1100), true);
    assert.strictEqual(limiter.allow('user1', 1200), true);
    assert.strictEqual(limiter.allow('user1', 1300), false);
  });

  it('should allow requests again after windowMs expires', () => {
    const limiter = new SlidingWindowLimiter({ maxRequests: 3, windowMs: 1000 });
    
    assert.strictEqual(limiter.allow('user2', 1000), true);
    assert.strictEqual(limiter.allow('user2', 1100), true);
    assert.strictEqual(limiter.allow('user2', 1200), true);
    assert.strictEqual(limiter.allow('user2', 1300), false);
    
    // After 1000ms window passes, old requests expire
    assert.strictEqual(limiter.allow('user2', 2001), true);
    assert.strictEqual(limiter.allow('user2', 2100), true);
    assert.strictEqual(limiter.allow('user2', 2200), true);
    assert.strictEqual(limiter.allow('user2', 2300), false);
  });

  it('should isolate different users', () => {
    const limiter = new SlidingWindowLimiter({ maxRequests: 2, windowMs: 1000 });
    
    assert.strictEqual(limiter.allow('userA', 1000), true);
    assert.strictEqual(limiter.allow('userA', 1100), true);
    assert.strictEqual(limiter.allow('userA', 1200), false);
    
    // Different user should have independent limit
    assert.strictEqual(limiter.allow('userB', 1000), true);
    assert.strictEqual(limiter.allow('userB', 1100), true);
    assert.strictEqual(limiter.allow('userB', 1200), false);
  });

  it('should clean up old timestamps to prevent memory leak', () => {
    const limiter = new SlidingWindowLimiter({ maxRequests: 5, windowMs: 1000 });
    
    // Make requests
    limiter.allow('user3', 1000);
    limiter.allow('user3', 1100);
    
    // Move time forward past window
    limiter.allow('user3', 2500);
    
    // Old timestamps should be cleaned; only the 2500 request remains
    // (We can't directly inspect internal state, but we can verify behavior)
    assert.strictEqual(limiter.allow('user3', 2600), true);
    assert.strictEqual(limiter.allow('user3', 2700), true);
    assert.strictEqual(limiter.allow('user3', 2800), true);
    assert.strictEqual(limiter.allow('user3', 2900), true);
    assert.strictEqual(limiter.allow('user3', 3000), false);
  });

  it('should return correct remaining count via getRemaining', () => {
    const limiter = new SlidingWindowLimiter({ maxRequests: 3, windowMs: 1000 });
    
    // Initially full remaining
    assert.strictEqual(limiter.getRemaining('user4', 1000), 3);
    
    // After one request
    limiter.allow('user4', 1000);
    assert.strictEqual(limiter.getRemaining('user4', 1100), 2);
    
    // After two more requests
    limiter.allow('user4', 1200);
    limiter.allow('user4', 1300);
    assert.strictEqual(limiter.getRemaining('user4', 1400), 0);
    
    // After window expires (only requests from 1001 onwards are valid)
    // At time 2001, window is [1001, 2001]. Requests at 1200 and 1300 are still in window.
    assert.strictEqual(limiter.getRemaining('user4', 2001), 1);
  });
});