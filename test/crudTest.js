/**
 * Created by ciprian on 15.02.2017.
 */
const logger = require('double-check').logger;
logger.logConfig.display.debug = false;

const acl = require("../lib/acl.js");
const container = require('safebox').container;
const apersistence = require('apersistence');
const redisClient = require('redis').createClient();

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


const assert = require('double-check').assert;
const testRules = [
    {
        "contextType": "swarm",
        "context": "swarmName1",
        "subcontextType": "ctor",
        "subcontext": "ctor1",
        "zone": "user1",
        "action": "execution",
        "type": "white_list"
    },
    {
        "contextType": "swarm",
        "context": "swarmName1",
        "subcontextType": "ctor",
        "subcontext": "ctor2",
        "zone": "user2",
        "action": "execution",
        "type": "white_list"

    },
    {
        "contextType": "swarm",
        "context": "swarmName1",
        "zone": "admin",
        "action": "execution",
        "type": "white_list"

    },
    {
        "contextType": "swarm",
        "context": "swarmName1",
        "subcontextType": "ctor",
        "subcontext": "ctor1",
        "zone": "admin",
        "action": "execution",
        "type": "black_list"

    },
    {
        "contextType": "swarm",
        "zone": "admin",
        "action": "monitor",
        "type": "black_list"
    }
]

container.declareDependency("crudTest", ['aclConfigurator'], function (outOfService, aclConfigurator) {
    if (outOfService) {
        assert.fail("Could not run 'crudTest'\nDependencies were not met");
    } else {
        aclConfigurator.getRules(function (err, result) {
            if (err) {
                assert.fail(err.message)
            } else {
                assert.true(result.length === 0, "The redis persistence is not empty");
                assert.callback("CRUD rules test", function (end) {
                    runTest(aclConfigurator, end);
                })
            }
        })
    }
});


function runTest(aclConfigurator, end) {
    insertRules(function (err) {
        if (err) {
            assert.fail("Failed to persist rules\nErrors encountered:\n", err);
        } else {
            aclConfigurator.getRules(function (err, allRules) {
                if (err) {
                    assert.fail("Failed to retrieve rules from persistence\nErrors encountered:\n", err);
                } else if (allRules.length !== testRules.length) {
                    assert.fail("Failed persist all rules\nNr of missing rules is:" + (testRules.length - allRules.length));
                } else {
                    removeRules(allRules, function (err) {
                        if (err) {
                            assert.fail("Failed remove all rules\nErrors encountered:", err);
                        } else {
                            end();
                            aclConfigurator.flushExistingRules(function () {
                                redisClient.quit();
                            })
                        }
                    })
                }
            })
        }
    });

    function insertRules(callback) {
        let rulesAdded = 0;
        const errors = [];
        testRules.forEach(function (rule) {
            aclConfigurator.addRule(rule, true, function (err) {
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

    function removeRules(rules, callback) {
        let rulesRemoved = 0;
        const errors = [];
        rules.forEach(function (rule) {
            aclConfigurator.removeRule(rule, true, function (err) {
                if (err) {
                    errors.push(err);
                } else {
                    rulesRemoved++;
                }
                if (rulesRemoved + errors.length === testRules.length) {
                    if (errors.length > 0) {
                        callback(errors);
                    } else {
                        callback();
                    }
                }
            })
        })
    }
}
