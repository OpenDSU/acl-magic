/*
    A simple cache implementation that periodically removes everything from cache.
    We purge everything to avoid consuming too much memory in large systems. This should be enough for normal usages.
    For an highly optimised version, ask our commercial offers.
 */

function ExpiringCache() {
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


    const err = new Error();
    this.loadAll = function (space, key, callback) {
        const arr = [];
        if (!storage[space] || !storage[space][key]) {
            callback(err, null);
            return;
        }

        for (let v in storage[space][key]) {
            arr.push(v);
        }
        callback(null, arr);
    }
}


module.exports.createCache = function (expireTime) {
    return new ExpiringCache(expireTime);
}