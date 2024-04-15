const persist = require("./lib/persistence.js");
const cache = require("./lib/cache.js");

module.exports.createEnclavePersistence = function (enclave, cache, type) {
    if (!cache) {
        cache = module.exports.createCache();
    }
    return persist.createEnclavePersistence(enclave, cache, type);
}

module.exports.createMemoryPersistence = function () {
    return persist.createMemoryPersistence();
};

module.exports.createCache = function (timeOut) {
    return cache.createCache(timeOut); /* somethink like 60*1000 or more*/
};


function lazyAsyncDeepTreeChecker(root, getChildren, checkFunction, returnCallBack) {
    let intermediateGenerators = [];
    intermediateGenerators.push(root);
    let waitingAsyncCall = 0;

    function checkNextNode() {
        if (!intermediateGenerators) {
            return;
        }

        const currentNode = intermediateGenerators.shift();
        if (!currentNode) {
            if (waitingAsyncCall == 0) {
                intermediateGenerators = null;
                returnCallBack(null, false);
            } else {
                return; //will be triggered again from other call
            }
        }
        waitingAsyncCall++;
        getChildren(currentNode, function (err, arr) {
            if (intermediateGenerators) {
                waitingAsyncCall--;
                arr.map(function (n) {
                    intermediateGenerators.push(n);
                });
                if (waitingAsyncCall == 0) {
                    checkNextNode(); //just in case the main checking chain is already stopped because getChildren was slower than the checkFunction
                }
            }
        });

        waitingAsyncCall++;
        checkFunction(currentNode, function (err, res) {
            waitingAsyncCall--;
            if (res) {
                intermediateGenerators = null;
                returnCallBack(null, true);
            } else {
                checkNextNode();
            }
        })
    }

    checkNextNode();
}

function Concern(concernName, persistence, exceptionalRulesFunction, afterCheckFunction) {
    this.grant = function (zoneId, resourceId, callback) {
        persistence.grant(concernName, zoneId, resourceId, callback);
    }

    this.ungrant = function (zoneId, resourceId, callback) {
        persistence.ungrant(concernName, zoneId, resourceId, callback);
    }

    this.addResourceParent = function (resourcesUID, parentUid, callback) {
        persistence.addResourceParent(resourcesUID, parentUid, callback);
    }

    this.addZoneParent = function (zoneId, parentZoneId, callback) {
        persistence.addZoneParent(zoneId, parentZoneId, callback);
    }

    /*
        allow return by calling callback(null,true) or callback(null,false). It should return only once.
     */

    this.allow1 = function (zoneId, resourceId, callback) {
        const allParentZones = persistence.loadZoneParents.async(zoneId);
        let exceptionAllow;
        if (exceptionalRulesFunction) {
            exceptionAllow = exceptionalRulesFunction.async(zoneId, resourceId);
        } else {
            exceptionAllow = false;
        }

        (function (allParentZones, exceptionAllow) {
            if (exceptionAllow) {
                intermediateReturnCallback(null, true);
            } else {
                lazyAsyncDeepTreeChecker(resourceId,
                    function (node, callback) { //get children
                        const parents = persistence.loadResourceDirectParents.async(node);
                        (function (parents) {
                            callback(null, parents);
                        }).wait(parents);
                    },
                    function (node, callback) { //checkFunction
                        const resourceGrants = persistence.loadResourceDirectGrants.async(concernName, node);
                        (function (resourceGrants) {
                            if (notDisjoint(resourceGrants, allParentZones)) {
                                callback(null, true);
                            } else {
                                callback(null, false);
                            }
                        }).wait(resourceGrants);
                    },
                    intermediateReturnCallback  //pass the result callback to report success (true) on first successful check or false at the end
                );
            }
        }).wait(allParentZones, exceptionAllow);

        function notDisjoint(arr1, arr2) {
            const o = {};
            for (let i = 0, l = arr1.length; i < l; i++) {
                o[arr1[i]] = true;
            }

            for (let i = 0, l = arr2.length; i < l; i++) {
                if (o[arr2[i]]) {
                    return true;
                }
            }
            return false;
        }


        function intermediateReturnCallback(err, res) {
            if (afterCheckFunction) {
                afterCheckFunction(zoneId, resourceId, function (err, afterCheckAllow) {
                    if (err) {
                        callback(err);
                    } else if (afterCheckAllow) {
                        callback(undefined, afterCheckAllow);
                    } else {
                        callback(undefined, res);
                    }
                });
            } else {
                callback(undefined, res);
            }
        }


    }

    this.allow = function (zoneId, resourceId, callback) {
        if (exceptionalRulesFunction) {
            exceptionalRulesFunction(zoneId, resourceId, function (err, favorableException) {
                if (err) {
                    callback(err);
                } else if (favorableException === true) {
                    intermediateReturnCallback(undefined, true);
                } else {
                    checkTree();
                }
            })
        } else {
            checkTree();
        }

        function checkTree() {
            persistence.loadZoneParents(zoneId, function (err, allParentZones) {
                if (err) {
                    callback(err);
                } else {
                    lazyAsyncDeepTreeChecker(resourceId,
                        function (node, callback) { //get children
                            process.nextTick(function () {
                                persistence.loadResourceDirectParents(node, function (err, parents) {
                                    if (err) {
                                        callback(err);
                                    } else {
                                        callback(null, parents);
                                    }
                                });
                            })
                        },
                        function (node, callback) { //checkFunction
                            persistence.loadResourceDirectGrants(concernName, node, function (err, resourceGrants) {
                                if (err) {
                                    callback(err);
                                } else if (notDisjoint(resourceGrants, allParentZones)) {
                                    callback(null, true);
                                } else {
                                    callback(null, false);
                                }
                            })
                        },
                        intermediateReturnCallback  //pass the result callback to report success (true) on first successful check or false at the end
                    );
                }
            })
        }

        function notDisjoint(arr1, arr2) {
            const o = {};
            for (let i = 0, l = arr1.length; i < l; i++) {
                o[arr1[i]] = true;
            }

            for (let i = 0, l = arr2.length; i < l; i++) {
                if (o[arr2[i]]) {
                    return true;
                }
            }
            return false;
        }

        function intermediateReturnCallback(err, res) {
            if (afterCheckFunction) {
                afterCheckFunction(zoneId, resourceId, function (err, afterCheckAllow) {
                    if (err) {
                        callback(err);
                    } else if (afterCheckAllow) {
                        callback(undefined, afterCheckAllow);
                    } else {
                        callback(undefined, res);
                    }
                });
            } else {
                callback(undefined, res);
            }
        }
    }
}

module.exports.createConcern = function (concernName, persistence, exceptionalRulesFunction, afterCheckFunction) {
    return new Concern(concernName, persistence, exceptionalRulesFunction, afterCheckFunction);
}
