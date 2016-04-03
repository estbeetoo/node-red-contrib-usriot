/**
 * Created by boba on 31.03.16.
 */
var connectionFSM = require('../lib/connectionFSM.js');
var config = require('./config.js');
var should = require('should');
var connection = new connectionFSM(config);
connection.connect();