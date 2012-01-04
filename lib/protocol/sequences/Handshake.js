var Util         = require('util');
var Parser       = require('../../Parser');
var Packets      = require('../packets');
var Password     = require('../Password');
var BufferList   = require('../util/BufferList');
var Sequence     = require('./Sequence');

module.exports = Handshake;
Util.inherits(Handshake, Sequence);
function Handshake(properties) {
  Sequence.call(this);

  this.password      = properties.password;
  this.user          = properties.user;
  this.database      = properties.database;
  this.flags         = properties.flags;
  this.maxPacketSize = properties.maxPacketSize;
  this.charsetNumber = properties.charsetNumber;

  // The scrambleBuff received in the HandshakeInitializationPacket, we need to
  // keep a reference to it since mysql could ask us to use the old
  // authentication schema in reply to our initial auth attempt.
  this._scrambleBuff = null;
}

Handshake.prototype.start = function() {
  this.expect(new Packets.HandshakeInitializationPacket);
};

Handshake.prototype.handle = function(packet) {
  if (packet instanceof Packets.HandshakeInitializationPacket) {
    this.authenticate(packet);
    this.expect(new Packets.ResultPacket);
    return;
  }

  if (packet.constructor === Packets.ResultPacket) {
    var type = packet.type();
    if (!Packets[type]) throw new Error('Handshake.NotImplemented: ' + type);

    this.expect(packet.copy(new Packets[type]));
    return;
  }

  if (packet instanceof Packets.ErrorPacket) {
    throw new Error('Handshake.AuthenticationDenied: ' + packet.message.value);
    return;
  }

  if (packet instanceof Packets.OkPacket) {
    this.expect(null);
    this.emit('end');
    return;
  }

  throw new Error('Handshake.UnexpectedPacket: ' + Util.inspect(packet));
};

Handshake.prototype.authenticate = function(handshake) {
  var scrambleBuffer = this._scrambleBuff = new BufferList([
      handshake.scrambleBuff1,
      handshake.scrambleBuff2
  ]);

  this.emit('packet', new Packets.ClientAuthenticationPacket({
    number        : handshake.number.value + 1,
    scrambleBuff  : Password.token(this.password, scrambleBuffer),
    user          : this.user,
    databasename  : this.database,
    clientFlags   : this.flags,
    maxPacketSize : this.maxPacketSize,
    charsetNumber : this.charsetNumber,
  }));
};

Handshake.prototype._handleResultPacket = function(packet) {
  var type = packet.type();
  if (type === 'error') {
    packet = packet.copy(new Packets.ErrorPacket);
    console.error(packet);
  }
};

Handshake.prototype.handlePacket = function(packet) {
  if (packet.type == Parser.USE_OLD_PASSWORD_PROTOCOL_PACKET) {
    this.emit('packet', new Packets.ClientAuthenticationFallbackPacket({
      number       : packet.number + 1,
      scrambleBuff : Password.scramble323(this._scrambleBuff, this.password),
    }));
    return;
  }

  if (packet.type != Parser.ERROR_PACKET) {
    console.error(packet);
    this.emit('end');
    return;
  }

  // @TODO: Refactor WIP Emitting a packet on error is really goofy, this
  // should be a node error object.
  this.emit('error', packet);
};