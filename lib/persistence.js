/*
        generic persistence for ACLs. Provide insert, remove and loadSet functions to create a persistence for other databases
*/

function GenericPersistence(cache, insertFunc, removeFunc, loadSet, existsResource) {

    function insertValue(space, key, value, callback) {
        cache.insertValue(space, key, value);
        if (insertFunc) {
            return insertFunc(space, key, value, callback);
        }

        if (callback) {
            callback();
        }
    }

    function removeValue(space, key, value, callback) {
        cache.removeValue(space, key, value);
        if (removeFunc) {
            return removeFunc(space, key, value, callback);
        }

        if (callback) {
            callback();
        }
    }

    function loadAll(space, key, callback) {
        cache.loadAll(space, key, function (err, res) {
            if (err) {
                if (loadSet) {
                    loadSet(space, key, callback);
                }
            } else {
                callback(null, res);
            }
        });
    }

    this.addResourceParent = function (resourcesUID, parentUID, callback) {
        insertValue("resources", resourcesUID, parentUID, callback);
    }

    this.addZoneParent = function (zoneId, parentZoneId, callback) {
        insertValue("zones", zoneId, parentZoneId, callback);
    }

    this.delResourceParent = function (resourcesUID, parentUID, callback) {
        removeValue("resources", resourcesUID, parentUID, callback);
    }

    this.delZoneParent = function (zoneId, parentZoneId, callback) {
        removeValue("zones", zoneId, parentZoneId, callback);
    }

    this.loadZoneParents = function (zoneId, callback) {
        const resObj = {};
        let waitingCounter = 0;

        const mkResArray = function () {
            const res = [zoneId];
            for (const v in resObj) {
                res.push(v);
            }
            return res;
        }

        function loadOneLevel(zoneId) {
            waitingCounter++;
            loadAll("zones", zoneId, function (err, arr) {
                arr.map(function (i) {
                    resObj[i] = i;
                    loadOneLevel(i);
                })
                waitingCounter--;
                if (0 === waitingCounter) {
                    callback(null, mkResArray());
                }
            });
        }

        loadOneLevel(zoneId);

    }

    this.grant = function (concernName, zoneId, resourceId, callback) {
        insertValue(concernName, resourceId, zoneId, callback);
    }

    this.ungrant = function (concernName, zoneId, resourceId, callback) {
        removeValue(concernName, resourceId, zoneId, callback);
    }


    this.loadResourceDirectParents = function (resourceId, callback) {
        loadAll("resources", resourceId, callback);
    }


    this.loadResourceDirectGrants = function (concern, resourceId, callback) {
        loadAll(concern, resourceId, callback);
    }


    this.getProperty = function (propertyName, callback) {
        const props = loadAll.nasync("acl-properties", propertyName);
        (function (props) {
            if (props) {
                const value = props[propertyName];
                callback(null, value);
            } else {
                callback(null, false);
            }
        }).wait(props)
    }

    this.setProperty = function (propertyName, value, callback) {
        insertValue("acl-properties", propertyName, value, callback);
    }

    this.localResourceExists = function (localResourceName, resourceType, callback) {
        if (existsResource) {
            existsResource(localResourceName, resourceType, callback)
        } else {
            callback("Implementation not provided for resource existence verification")
        }
    }
}


/*
 Dummy cache with no expiration or other behaviour
 */


function NoExpireCache() {
    const storage = {};

    function initialise(space, key) {
        if (!storage[space]) {
            storage[space] = {};
        }

        if (!storage[space][key]) {
            storage[space][key] = {};
        }
    }

    this.insertValue = function (space, key, value) {
        initialise(space, key);
        storage[space][key][value] = value;
    }

    this.removeValue = function (space, key, value) {
        initialise(space, key);
        delete storage[space][key][value];
    }


    this.loadAll = function (space, key, callback) {
        const arr = [];
        initialise(space, key);
        for (const v in storage[space][key]) {
            arr.push(v);
        }
        callback(null, arr);
    }
}

module.exports.createEnclavePersistence = function (enclave, cache, type) {
    if (!cache) {
        cache = new NoExpireCache();
    }

    function mkKey(space, key) {
        if (type) {
            return "acl_magic_" + type + "_" + space + "_" + key;

        } else {
            return "acl_magic_" + space + "_" + key;
        }
    }

    return new GenericPersistence(cache,
        function (space, key, value, callback) {
            enclave._insertRecord(mkKey(space, key), value, {value: value}, callback)
        },
        function (space, key, value, callback) {
            enclave._deleteRecord(mkKey(space, key), value, callback)
        },
        function (space, key, callback) {
            enclave._getAllRecords(mkKey(space, key), (err, results) => {
                if (err) {
                    return callback(err);
                }
                if (!results) {
                    callback(undefined, [])
                    return;
                }
                if (Object.keys(results).length == 0) {
                    results = []
                }
                callback(null, results.map(result => result.value))
            })
        },
        function (localResourceName, resourceType, callback) {
            enclave._getAllRecords(mkKey("resources", localResourceName), (err, results) => {
                if (err) {
                    return callback(err, null);
                }
                if (results.length == 0 || Object.keys(results).length == 0) {
                    return callback(null, false)
                }
                return callback(null, results.find(parent => parent.pk == resourceType) !== undefined)
            })
        }
    );
}


module.exports.createMemoryPersistence = function () {
    return new GenericPersistence(new NoExpireCache());
}



