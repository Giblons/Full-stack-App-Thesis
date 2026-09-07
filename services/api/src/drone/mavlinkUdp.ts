import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  MavLinkProtocolV2,
  createMavLinkStream,
  type MavLinkData,
  type MavLinkPacket,
} from 'node-mavlink';

export interface UdpPeer {
  address: string;
  port: number;
}

/**
 * A thin MAVLink-over-UDP client for talking to PX4 SITL.
 *
 * It binds a local UDP port and uses node-mavlink to parse the incoming byte
 * stream into typed packets. It "learns" the peer (address + source port) from
 * the first datagram it receives and sends everything back there — this is the
 * standard single-socket UDP routing PX4/MAVSDK use (PX4 sends telemetry from,
 * and listens for commands on, the same port), so it works against a default
 * PX4 SITL `udp://:14540` endpoint without any extra configuration.
 *
 * Emits:
 *   - 'packet' (MavLinkPacket) for every decoded MAVLink message
 *   - 'error'  (Error)
 */
export class UdpMavlink extends EventEmitter {
  private readonly socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  private readonly input = new PassThrough();
  private readonly protocol: MavLinkProtocolV2;
  private seq = 0;
  private peer: UdpPeer | null = null;
  private closed = false;

  constructor(
    private readonly sysid = 255,
    private readonly compid = 190, // MAV_COMP_ID_MISSIONPLANNER
  ) {
    super();
    this.protocol = new MavLinkProtocolV2(sysid, compid);

    const reader = createMavLinkStream(this.input);
    reader.on('data', (packet: MavLinkPacket) => this.emit('packet', packet));
    reader.on('error', (err: Error) => this.emit('error', err));

    this.socket.on('message', (buffer, rinfo) => {
      // Track the most recent peer so replies reach PX4's link socket.
      this.peer = { address: rinfo.address, port: rinfo.port };
      this.input.write(buffer);
    });
    this.socket.on('error', (err) => this.emit('error', err));
  }

  /** Bind the local UDP port and start receiving. */
  bind(port: number, address = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error): void => reject(err);
      this.socket.once('error', onError);
      this.socket.bind(port, address, () => {
        this.socket.off('error', onError);
        resolve();
      });
    });
  }

  hasPeer(): boolean {
    return this.peer !== null;
  }

  /** Override the peer (e.g. to send before any packet has been received). */
  setPeer(peer: UdpPeer): void {
    this.peer = peer;
  }

  /** Serialize and send a MAVLink message to the current peer. No-op if unknown. */
  async send(message: MavLinkData): Promise<void> {
    if (this.closed || !this.peer) return;
    const buffer = this.protocol.serialize(message, this.seq);
    this.seq = (this.seq + 1) & 0xff;
    const { address, port } = this.peer;
    await new Promise<void>((resolve, reject) => {
      this.socket.send(buffer, port, address, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.input.end();
    await new Promise<void>((resolve) => this.socket.close(() => resolve()));
  }
}
