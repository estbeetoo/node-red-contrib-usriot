/**
 * Created by aborovsky on 27.08.2015.
 */

var util = require('util');
var DEBUG = false;
var connectionFSM = require('./lib/connectionFSM.js');

module.exports = function(RED) {

  /**
   * ====== Denon-controller ================
   * Holds configuration for usriotjs host+port,
   * initializes new usriotjs connections
   * =======================================
   */
  function DenonControllerNode(config) {
    RED.nodes.createNode(this, config);
    this.name = config.name;
    this.host = config.host;
    this.port = config.port;
    this.usriot = null;
    var node = this;

    /**
     * Initialize an usriot_telnet socket, calling the handler function
     * when successfully connected, passing it the usriot_telnet connection
     */
    this.initializeDenonConnection = function(handler) {
      if (node.usriot) {
        DEBUG && RED.comms.publish("debug", {
          name: node.name,
          msg: 'already configured connection to Denon player at ' + config.host + ':' + config.port
        });
        if (handler && (typeof handler === 'function')) {
          if (node.usriot.connection && node.usriot.connected)
            handler(node.usriot);
          else {
            if (node.usriot.connection && !node.usriot.connected)
              node.usriot.connect();
            node.usriot.on('connected', function() {
              handler(node.usriot);
            });

          }
        }
        return node.usriot;
      }
      node.log('configuring connection to Denon player at ' + config.host + ':' + config.port);
      node.usriot = new connectionFSM({
        host: config.host,
        port: config.port,
        debug: DEBUG
      });
      node.usriot.connect();
      if (handler && (typeof handler === 'function')) {
        node.usriot.on('connected', function() {
          handler(node.usriot);
        });
      }
      DEBUG && RED.comms.publish("debug", {
        name: node.name,
        msg: 'Denon: successfully connected to ' + config.host + ':' + config.port
      });

      return node.usriot;
    };
    this.on("close", function() {
      node.log('disconnecting from usriot device at ' + config.host + ':' + config.port);
      node.usriot && node.usriot.disconnect && node.usriot.disconnect();
      node.usriot = null;
    });
  }

  RED.nodes.registerType("usriot-controller", DenonControllerNode);

  /**
   * ====== Denon-out =======================
   * Sends outgoing Denon player from
   * messages received via node-red flows
   * =======================================
   */
  function DenonOut(config) {
    RED.nodes.createNode(this, config);
    this.name = config.name;
    var controllerNode = RED.nodes.getNode(config.controller);
    this.unit_number = config.unit_number;
    this.usriotcommand = config.usriotcommand;
    var node = this;
    this.on("input", function(msg) {
      DEBUG && RED.comms.publish("debug", {
        name: node.name,
        msg: 'usriotout.onInput msg[' + util.inspect(msg) + ']'
      });
      //node.log('usriotout.onInput msg[' + util.inspect(msg) + ']');
      if (!(msg && msg.hasOwnProperty('payload'))) return;
      var payload = msg.payload;
      if (typeof(msg.payload) === "object") {
        payload = msg.payload;
      } else if (typeof(msg.payload) === "string") {
        try {
          payload = JSON.parse(msg.payload);
          if (typeof (payload) === 'number')
            payload = {cmd: msg.payload.toString()};
        } catch (e) {
          payload = {cmd: msg.payload.toString()};
        }
      }
      else
        payload = {cmd: msg.payload.toString()};
      if (payload == null) {
        node.log('usriotout.onInput: illegal msg.payload!');
        return;
      }

      //If msg.topic is filled, than set it as cmd
      if (msg.topic) {
        if (payload.value === null || payload.value === undefined)
          payload.value = payload.cmd;
        payload = {cmd: msg.topic.toString(), value: payload.value};
      }

      if (node.usriotcommand && node.usriotcommand !== 'empty') {
        try {
          payload = JSON.parse(node.usriotcommand);
          if (typeof (payload) === 'number')
            payload.cmd = node.usriotcommand.toString();
        } catch (e) {
          payload.cmd = node.usriotcommand.toString();
        }
      }

      node.send(payload, function(err) {
        if (err) {
          node.error('send error: ' + err);
        }
        if (typeof(msg.cb) === 'function')
          msg.cb(err);
      });

    });
    this.on("close", function() {
      node.log('usriotOut.close');
    });

    node.status({fill: "yellow", shape: "dot", text: "inactive"});

    function nodeStatusConnected() {
      node.status({fill: "green", shape: "dot", text: "connected"});
    }

    function nodeStatusDisconnected() {
      node.status({fill: "red", shape: "dot", text: "disconnected"});
    }

    function nodeStatusReconnect() {
      node.status({fill: "yellow", shape: "ring", text: "reconnecting"});
    }

    function nodeStatusConnecting() {
      node.status({fill: "green", shape: "ring", text: "connecting"});
    }

    controllerNode.initializeDenonConnection(function(fsm) {
      if (fsm.connected)
        nodeStatusConnected();
      else
        nodeStatusDisconnected();
      fsm.off('connecting', nodeStatusConnecting);
      fsm.on('connecting', nodeStatusConnecting);
      fsm.off('connected', nodeStatusConnected);
      fsm.on('connected', nodeStatusConnected);
      fsm.off('disconnected', nodeStatusDisconnected);
      fsm.on('disconnected', nodeStatusDisconnected);
      fsm.off('reconnect', nodeStatusReconnect);
      fsm.on('reconnect', nodeStatusReconnect);
    });

    this.send = function(data, callback) {
      DEBUG && RED.comms.publish("debug", {name: node.name, msg: 'send data[' + JSON.stringify(data) + ']'});
      controllerNode.initializeDenonConnection(function(fsm) {
        try {
          DEBUG && RED.comms.publish("debug", {name: node.name, msg: "send:  " + JSON.stringify(data)});
          data.cmd = data.cmd || data.method;
          data.value = data.value || data.params;
          switch (data.cmd.toLowerCase()) {
            case 'setvolumedb':
              fsm.connection.setVolumeDb(parseFloat(data.value), function(error, response) {
                if (!callback)
                  return;
                if (error)
                  callback && callback(error, response);
                else
                  callback(response);
              });
              break;
            default:
              fsm.connection.send(data.cmd, function(error, response) {
                if (!callback)
                  return;
                if (error)
                  callback && callback(error, response);
                else
                  callback(response);
              });
          }
        }
        catch (err) {
          node.error('error calling send: ' + err);
          callback(err);
        }
      });
    }
  }

  //
  RED.nodes.registerType("usriot-out", DenonOut);

  /**
   * ====== Denon-IN ========================
   * Handles incoming Global Cache, injecting
   * json into node-red flows
   * =======================================
   */
  function DenonIn(config) {
    RED.nodes.createNode(this, config);
    this.name = config.name;
    this.connection = null;
    var node = this;
    //node.log('new DenonIn, config: %j', config);
    var controllerNode = RED.nodes.getNode(config.controller);

    /* ===== Node-Red events ===== */
    function nodeStatusConnecting() {
      node.status({fill: "green", shape: "ring", text: "connecting"});
    }

    function nodeStatusConnected() {
      node.status({fill: "green", shape: "dot", text: "connected"});
    }

    function nodeStatusDisconnected() {
      node.status({fill: "red", shape: "dot", text: "disconnected"});
    }

    function nodeStatusReconnect() {
      node.status({fill: "yellow", shape: "ring", text: "reconnecting"});
    }

    node.receiveNotification = function(notification, data) {
      DEBUG && RED.comms.publish("debug", {
        name: node.name,
        msg: 'usriot event data[' + JSON.stringify(data) + ']'
      });
      node.send({
        topic: 'usriot',
        payload: {
          'notification': notification,
          'data': data
        }
      });
    };

    controllerNode.initializeDenonConnection(function(fsm) {
      if (fsm.connected)
        nodeStatusConnected();
      else
        nodeStatusDisconnected();
      fsm.off('connecting', nodeStatusConnecting);
      fsm.on('connecting', nodeStatusConnecting);
      fsm.off('connected', nodeStatusConnected);
      fsm.on('connected', nodeStatusConnected);
      fsm.off('disconnected', nodeStatusDisconnected);
      fsm.on('disconnected', nodeStatusDisconnected);
      fsm.off('reconnect', nodeStatusReconnect);
      fsm.on('reconnect', nodeStatusReconnect);
    });
  }

  RED.nodes.registerType("usriot-in", DenonIn);
}