const net = require('net');
const EventEmitter = require('events');

class Nut extends EventEmitter {
    constructor(port, host) {
        super();
        this._port = port;
        this._host = host;

        this.status = 'idle';
        this.dataInBuff = '';

        this._client = new net.Socket();
        this._client.setEncoding('ascii');

        this._client.on('data', data => {
            this.dataInBuff += data;

            if (this.dataInBuff.slice(-1) !== '\n') {
                return;
            }

            if (typeof (this.parseFunc) === 'undefined') {
                this.status = 'idle';
            } else {
                this.parseFunc(this.dataInBuff);
                this.dataInBuff = '';
            }
        });

        this._connected = false;
        this._client.on('connect', () => {
            this._connected = true;
            this.emit('connected');
        });
        this._client.on('error', err => {
            this._connected = false;
            this.emit('error', err);
        });
        this._client.on('close', hadError => {
            this._connected = false;
            this.emit('disconnected', hadError);
        });
    }

    get connected() {
        return this._connected;
    }

    connect() {
        return new Promise(resolve => {
            this._client.connect(this._port, this._host, () => {
                resolve();
            });
        });
    }

    send(cmd, parseFunc) {
        if (this.status === 'idle') {
            this.status = 'waiting';
            this.parseFunc = parseFunc;
            this._client.write(cmd + '\n');
        } else if (parseFunc) {
            parseFunc('ERR Other communication still running\n');
        }
    }

    disconnect() {
        this.send('LOGOUT');
        this._client.end();
    }

    _callbackOrPromise(callback, proc) {
        if (callback) {
            proc(callback);
        } else {
            return new Promise((resolve, reject) => {
                proc((res, err) => {
                    if (err) {
                        if (err instanceof Error) {
                            reject(err);
                        } else {
                            reject(new Error(err));
                        }
                    } else {
                        resolve(res);
                    }
                });
            });
        }
    }

    _parseKeyValueList(data, listType, re, callback) {
        if (!data) {
            callback(null, 'Empty response');
            return;
        }

        const dataArray = data.split('\n');

        const vars = {};
        for (const line of dataArray) {
            if (line.indexOf('BEGIN LIST ' + listType) === 0) {
                // ...
            } else if (line.indexOf(listType + ' ') === 0) {
                const matches = re.exec(line);
                vars[matches[1]] = matches[2];
            } else if (line.indexOf('END LIST ' + listType) === 0) {
                callback(vars, null);
                break;
            } else if (line.indexOf('ERR') === 0) {
                callback(null, line.slice(4));
                break;
            }
        }
    }

    getUpsList(callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('LIST UPS', data => {
                this._parseKeyValueList(data, 'UPS', /^UPS\s+(.+)\s+"(.*)"/, (vars, err) => {
                    this.status = 'idle';
                    callback(vars, err);
                });
            });
        });
    }

    getUpsVars(ups, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('LIST VAR ' + ups, data => {
                this._parseKeyValueList(data, 'VAR', /^VAR\s+.+\s+(.+)\s+"(.*)"/, (vars, err) => {
                    this.status = 'idle';
                    callback(vars, err);
                });
            });
        });
    }

    getUpsCommands(ups, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('LIST CMD ' + ups, data => {
                if (!data) {
                    data = 'ERR Empty response\n';
                }

                const dataArray = data.split('\n');

                const re = /^CMD\s+.+\s+(.+)/;
                const commands = [];
                for (const line of dataArray) {
                    if (line.indexOf('BEGIN LIST CMD') === 0) {
                        // ...
                    } else if (line.indexOf('CMD ' + ups) === 0) {
                        const matches = re.exec(line);
                        commands.push(matches[1]);
                    } else if (line.indexOf('END LIST CMD') === 0) {
                        this.status = 'idle';
                        callback(commands, null);
                        break;
                    } else if (line.indexOf('ERR') === 0) {
                        this.status = 'idle';
                        callback(null, line.slice(4));
                        break;
                    }
                }
            });
        });
    }

    getRwVars(ups, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('LIST RW ' + ups, function (data) {
                this._parseKeyValueList(data, 'RW', /^RW\s+.+\s+(.+)\s+"(.*)"/, (vars, err) => {
                    this.status = 'idle';
                    callback(vars, err);
                });
            });
        });
    }

    getEnumsForVar(ups, name, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('LIST ENUM ' + ups + ' ' + name, data => {
                if (!data) {
                    data = 'ERR Empty response\n';
                }

                const dataArray = data.split('\n');

                const re = /^ENUM\s+.+\s+.+\s+"(.*)"/;
                const enums = [];
                for (const line of dataArray) {
                    if (line.indexOf('BEGIN LIST ENUM') === 0) {
                        // ...
                    } else if (line.indexOf('ENUM ' + ups + ' ' + name) === 0) {
                        const matches = re.exec(line);
                        enums.push(matches[1]);
                    } else if (line.indexOf('END LIST ENUM') === 0) {
                        this.status = 'idle';
                        callback(enums, null);
                        break;
                    } else if (line.indexOf('ERR') === 0) {
                        this.status = 'idle';
                        callback(null, line.slice(4));
                        break;
                    }
                }
            });
        });
    }

    getRangesForVar(ups, name, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('LIST RANGE ' + ups + ' ' + name, data => {
                if (!data) {
                    data = 'ERR Empty response\n';
                }

                const dataArray = data.split('\n');

                const re = /^RANGE\s+.+\s+.+\s+"(.+)"\s+"(.+)"/;
                const ranges = [];
                for (const line of dataArray) {
                    if (line.indexOf('BEGIN LIST RANGE') === 0) {
                        // ...
                    } else if (line.indexOf('RANGE ' + ups + ' ' + name) === 0) {
                        const matches = re.exec(line);
                        ranges.push({
                            min: matches[1],
                            max: matches[2]
                        });
                    } else if (line.indexOf('END LIST RANGE') === 0) {
                        this.status = 'idle';
                        callback(ranges, null);
                        break;
                    } else if (line.indexOf('ERR') === 0) {
                        this.status = 'idle';
                        callback(null, line.slice(4));
                        break;
                    }
                }
            });
        });
    }

    getVarType(ups, name, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('GET TYPE ' + ups + ' ' + name, data => {
                if (!data) {
                    data = 'ERR Empty response';
                }

                this.status = 'idle';
                const re = /^TYPE\s+.+\s+.+\s+(.+)/;
                const matches = re.exec(data);
                if (matches && matches[1]) {
                    callback(matches[1], null);
                } else if (data.indexOf('ERR') === 0) {
                    callback(null, data.slice(4));
                } else {
                    callback(null, null);
                }
            });
        });
    }

    getVarDescription(ups, name, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('GET DESC ' + ups + ' ' + name, data => {
                if (!data) {
                    data = 'ERR Empty response';
                }

                this.status = 'idle';
                const re = /^DESC\s+.+\s+.+\s+"(.+)"/;
                const matches = re.exec(data);
                if (matches && matches[1]) {
                    callback(matches[1], null);
                } else if (data.indexOf('ERR') === 0) {
                    callback(null, data.slice(4));
                } else {
                    callback(null, null);
                }
            });
        });
    }

    getCommandDescription(ups, command, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('GET CMDDESC ' + ups + ' ' + command, data => {
                if (!data) {
                    data = 'ERR Empty response';
                }

                this.status = 'idle';
                const re = /^CMDDESC\s+.+\s+.+\s+"(.+)"/;
                const matches = re.exec(data);
                if (matches && matches[1]) {
                    callback(matches[1], null);
                } else if (data.indexOf('ERR') === 0) {
                    callback(null, data.slice(4));
                } else {
                    callback(null, null);
                }
            });
        });
    }

    _parseMinimalResult(data, callback) {
        if (data.indexOf('ERR') === 0) {
            data = data.slice(4);
            if (callback) {
                callback(data);
            }
        }

        if (callback) {
            callback(null);
        }
    }

    nutSetRWVar(ups, name, value, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('SET VAR ' + ups + ' ' + name + ' ' + value, data => {
                this.status = 'idle';
                this._parseMinimalResult(data, callback);
            });
        });
    }

    runUpsCommand(ups, command, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('INSTCMD ' + ups + ' ' + command, data => {
                this.status = 'idle';
                this._parseMinimalResult(data, callback);
            });
        });
    }

    setUsername(username, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('USERNAME ' + username, data => {
                this.status = 'idle';
                this._parseMinimalResult(data, callback);
            });
        });
    }

    setPassword(pwd, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('PASSWORD ' + pwd, data => {
                this.status = 'idle';
                this._parseMinimalResult(data, callback);
            });
        });
    }

    master(ups, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('MASTER ' + ups, data => {
                this.status = 'idle';
                this._parseMinimalResult(data, callback);
            });
        });
    }

    fsd(ups, callback) {
        this.send('FSD ' + ups, data => {
            if (!data) {
                data = 'ERR Empty response';
            }

            this.status = 'idle';
            if (data.indexOf('OK FSD-SET') === 0) {
                callback(null);
            } else {
                if (data.indexOf('ERR') === 0) {
                    data = data.slice(4);
                }

                callback(data);
            }
        });
    }

    help(callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('HELP', data => {
                this.status = 'idle';
                callback(data);
            });
        });
    }

    ver(callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('VER', data => {
                this.status = 'idle';
                callback(data);
            });
        });
    }

    netVer(callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('NETVER', data => {
                this.status = 'idle';
                callback(data);
            });
        });
    }

    listClients(ups, callback) {
        return this._callbackOrPromise(callback, callback => {
            this.send('LIST CLIENT ' + ups, data => {
                if (!data) {
                    data = 'ERR Empty response\n';
                }

                const dataArray = data.split('\n');

                const re = /^CLIENT\s+.+\s+(.+)/;
                const clients = [];
                for (const line of dataArray) {
                    if (line.indexOf('BEGIN LIST CLIENT') === 0) {
                        // ...
                    } else if (line.indexOf('CLIENT ' + ups) === 0) {
                        const matches = re.exec(line);
                        clients.push(matches[1]);
                    } else if (line.indexOf('END LIST CLIENT') === 0) {
                        this.status = 'idle';
                        callback(clients, null);
                        break;
                    } else if (line.indexOf('ERR') === 0) {
                        this.status = 'idle';
                        callback(null, line.slice(4));
                        break;
                    }
                }
            });
        });
    }
}

module.exports = Nut;
