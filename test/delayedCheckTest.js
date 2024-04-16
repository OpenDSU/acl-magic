/**
 * Created by ciprian on 20.02.2017.
 */

const logger = require('double-check').logger;
logger.logConfig.display.debug = false;

const acl = require("../lib/acl.js");

const container = require('safebox').container;
const apersistence = require('apersistence');
const redisClient = require('redis').createClient();
const assert = require('double-check').assert;


container.resolve("redisClient", redisClient);

container.declareDependency("redisPersistence", ["redisClient"], function (outOfService, redisClient) {
    if (outOfService) {
        logger.debug("Redis persistence failed");
    } else {
        logger.debug("Initialising Redis persistence...");
        const redisPersistence = apersistence.createRedisPersistence(redisClient);
        return redisPersistence;
    }
});

acl.enableACLConfigurator();
acl.enableACLChecker();

let testAlreadyRan = false;
container.declareDependency("delayedChecksTest", ['aclConfigurator', 'aclChecker'], function (outOfService, aclConfigurator, aclChecker) {
    if (!outOfService && !testAlreadyRan) {
        assert.callback("Delayed checks test", function (end) {
            testAlreadyRan = true;
            runTest(aclConfigurator, aclChecker, redisClient, end);
        });
    }
});


function runTest(aclConfigurator, aclChecker, redisClient, end) {
    const testRules = [
        {
            "contextType": "swarm",
            "context": "swarm1",
            "subcontextType": "ctor",
            "subcontext": "ctor1",
            "zone": "zone0",
            "action": "execution",
            "type": "white_list"
        },
        {
            "contextType": "swarm",
            "context": "swarm1",
            "subcontextType": "ctor",
            "subcontext": "ctor1",
            "zone": "zone1",
            "action": "execution",
            "type": "black_list"
        }
    ];

    const userZones = {
        "user1": ["zone1", "zone2"],
        "user2": ["zone1"],
        "user3": ["zone2"],
        "zone1": ["zone0"],
        "zone2": ["zone0"]
    };

    const resourceToAccess = ["swarm", "swarm1", "ctor", "ctor1", "execution"];

    const testCases = [{
        "user": "user1",
        "expectedResult": false
    }, {
        "user": "user2",
        "expectedResult": false
    }, {
        "user": "user3",
        "expectedResult": true
    }, {
        "user": "user4",
        "expectedResult": false
    }];

    insertRules(function (err) {
        if (err) {
            assert.fail("Failed to persist rules\nErrors encountered:\n", err);
        } else {
            let testsPassed = 0;
            createUserZones();

            logger.debug("Disabling redisClient");
            container.outOfService("redisClient");
            setTimeout(function () {
                logger.debug("Resolving redisClient");
                container.resolve("redisClient", redisClient);
            }, 300);

            testCases.forEach(function (testCase) {
                runTestCase(testCase, function (err, result) {
                    if (err) {
                        assert.fail(err.message);
                    } else {
                        assert.equal(result, testCase["expectedResult"], "delayedChecksTest failed for user " + testCase["user"])
                        testsPassed++;
                        if (testsPassed === testCases.length) {
                            end();
                            aclConfigurator.flushExistingRules(function () {
                                redisClient.quit();
                            })
                        }

                    }
                })
            })
        }
    });

    function insertRules(callback) {
        let rulesAdded = 0;
        const errors = [];
        testRules.forEach(function (rule) {
            aclConfigurator.addRule(rule, false, function (err) {
                if (err) {
                    errors.push(err);
                } else {
                    rulesAdded++;
                }
                if (rulesAdded + errors.length === testRules.length) {
                    if (errors.length > 0) {
                        callback(errors);
                    } else {
                        callback();
                    }
                }
            })
        })
    }

    function createUserZones() {
        for (const child in userZones) {
            userZones[child].forEach(function (parent) {
                aclConfigurator.addZoneParent(child, parent);
            });
        }
    }

    function runTestCase(testCase, callback) {
        aclChecker.apply({}, resourceToAccess.concat([testCase['user'], callback]));
    }
}
