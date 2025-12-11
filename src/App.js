import React, { useState, useRef, Suspense, useLayoutEffect, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, useGLTF, Center, Html } from '@react-three/drei';
import * as THREE from 'three';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Leaflet Icon Fix
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import './App.css';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// --- CONFIGURATION ---
// MAX_HISTORY is no longer used because we want to keep everything!

// --- MAP RECENTER HELPER ---
const RecenterMap = ({ lat, lon }) => {
  const map = useMap();
  useEffect(() => {
    if (lat && lon) map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
};

// --- 3D COMPONENTS ---
const DefaultRocket = ({ rotation }) => {
  const meshRef = useRef();
  if (meshRef.current) {
    meshRef.current.rotation.x = rotation.x;
    meshRef.current.rotation.y = rotation.y;
    meshRef.current.rotation.z = rotation.z;
  }
  return (
    <group ref={meshRef} scale={[2, 2, 2]}>
      <mesh position={[0, 0, 0]}><cylinderGeometry args={[0.5, 0.5, 2.5, 32]} /><meshStandardMaterial color="#e0e0e0" metalness={0.5} roughness={0.5} /></mesh>
      <mesh position={[0, 1.75, 0]}><coneGeometry args={[0.5, 1, 32]} /><meshStandardMaterial color="#ff4444" /></mesh>
      <mesh position={[0, -1, 0]}><boxGeometry args={[1.5, 0.1, 1.5]} /><meshStandardMaterial color="#444" /></mesh>
      <mesh position={[0, 0.5, 0.4]}><boxGeometry args={[0.2, 0.5, 0.2]} /><meshStandardMaterial color="#00ccff" /></mesh>
    </group>
  );
};

const CustomRocket = ({ url, rotation }) => {
  const { scene } = useGLTF(url);
  const groupRef = useRef();
  const innerRef = useRef();

  useLayoutEffect(() => {
    if (innerRef.current) {
      const box = new THREE.Box3().setFromObject(innerRef.current);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetSize = 6;
      if (maxDim > 0) {
        const scaleFactor = targetSize / maxDim;
        innerRef.current.scale.set(scaleFactor, scaleFactor, scaleFactor);
      }
    }
  }, [scene]);

  if (groupRef.current) {
    groupRef.current.rotation.x = rotation.x;
    groupRef.current.rotation.y = rotation.y;
    groupRef.current.rotation.z = rotation.z;
  }

  return (
    <group ref={groupRef}>
      <Center top><group ref={innerRef}><primitive object={scene} /></group></Center>
    </group>
  );
};

const Loader = () => <Html center><div style={{ color: 'white' }}>Loading Model...</div></Html>;

// --- MAIN APP ---
const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  const [currentData, setCurrentData] = useState({ lat: 18.5204, lon: 73.8567 });
  const [modelUrl, setModelUrl] = useState(null);
  const fileInputRef = useRef(null);
  const [orientation, setOrientation] = useState({ x: 0, y: 0, z: 0 });

  // Terminal Logs State
  const [rawLogs, setRawLogs] = useState([]);
  const terminalContentRef = useRef(null);

  const [history, setHistory] = useState({
    time: [],
    acc: { x: [], y: [], z: [] },
    gyro: { x: [], y: [], z: [] },
    vel: { x: [], y: [], z: [] },
    gps: { lat: [], lon: [], alt: [] }
  });

  const lastTimeRef = useRef(0);
  const velocityRef = useRef({ x: 0, y: 0, z: 0 });
  const rotationRef = useRef({ x: 0, y: 0, z: 0 });
  const gpsOriginRef = useRef(null);
  const simulationInterval = useRef(null);

  // Auto-scroll terminal
  useEffect(() => {
    const element = terminalContentRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [rawLogs]);

  // --- SERIAL CONNECTION ---
  const connectSerial = async () => {
    if (isSimulating) stopSimulation();
    try {
      if (!navigator.serial) {
        alert("Web Serial API not supported. Please use Chrome/Edge.");
        return;
      }
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      setIsConnected(true);
      readLoop(port);
    } catch (err) {
      console.error("Error connecting:", err);
    }
  };

  const readLoop = async (port) => {
    const reader = port.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.trim()) processData(line.trim());
        }
      }
    } catch (err) {
      console.error("Read Error:", err);
    } finally {
      reader.releaseLock();
      setIsConnected(false);
    }
  };

  // --- SIMULATION ---
  const startSimulation = () => {
    if (isSimulating) {
      stopSimulation();
      return;
    }
    setIsSimulating(true);
    let packetCount = 0;
    const startTime = Date.now();

    simulationInterval.current = setInterval(() => {
      const now = Date.now();
      const timeSec = (now - startTime) / 1000;
      packetCount++;

      const alt = 150 + (timeSec * 2.5);
      const press = 1013.25 - (alt / 100);
      const temp = 28.5 - (alt / 1000);

      const lat = 18.5204 + (0.0002 * Math.cos(timeSec * 0.5));
      const lon = 73.8567 + (0.0002 * Math.sin(timeSec * 0.5));
      const ax = (Math.random() - 0.5) * 0.5;
      const ay = (Math.random() - 0.5) * 0.5;
      const az = 9.81 + (Math.random() - 0.5);
      const gx = Math.sin(timeSec) * 15;
      const gy = 30;
      const gz = Math.cos(timeSec) * 15;

      const fakeCsvLine = `1001,${timeSec.toFixed(2)},${packetCount},${alt.toFixed(2)},${press.toFixed(2)},${temp.toFixed(2)},${ax.toFixed(2)},${ay.toFixed(2)},${az.toFixed(2)},${gx.toFixed(2)},${gy.toFixed(2)},${gz.toFixed(2)},12:00:00,${lat.toFixed(6)},${lon.toFixed(6)},${alt.toFixed(2)},8`;
      processData(fakeCsvLine);
    }, 50);
  };

  const stopSimulation = () => {
    if (simulationInterval.current) clearInterval(simulationInterval.current);
    setIsSimulating(false);
  };

  // --- DATA PARSING ---
  const processData = (csvString) => {
    setRawLogs(prev => [...prev, csvString].slice(-50));

    const d = csvString.split(',');
    if (d.length < 17) return;

    const t = parseFloat(d[1]);
    const raw = {
      teamId: d[0], time: t, packet: d[2],
      alt: parseFloat(d[3]), press: parseFloat(d[4]), temp: parseFloat(d[5]),
      ax: parseFloat(d[6]), ay: parseFloat(d[7]), az: parseFloat(d[8]),
      gx: parseFloat(d[9]), gy: parseFloat(d[10]), gz: parseFloat(d[11]),
      gpsTime: d[12], lat: parseFloat(d[13]), lon: parseFloat(d[14]), gpsAlt: parseFloat(d[15]), sats: d[16]
    };

    let dt = 0;
    if (lastTimeRef.current > 0) dt = t - lastTimeRef.current;

    if (dt > 0 && dt < 1.0) {
      velocityRef.current.x += raw.ax * dt;
      velocityRef.current.y += raw.ay * dt;
      velocityRef.current.z += (raw.az - 9.81) * dt;
      const degToRad = Math.PI / 180;
      rotationRef.current.x += (raw.gx * dt) * degToRad;
      rotationRef.current.y += (raw.gy * dt) * degToRad;
      rotationRef.current.z += (raw.gz * dt) * degToRad;
    }
    lastTimeRef.current = t;

    if (!gpsOriginRef.current) gpsOriginRef.current = { lat: raw.lat, lon: raw.lon, alt: raw.gpsAlt };

    const latM = (raw.lat - gpsOriginRef.current.lat) * 111139;
    const lonM = (raw.lon - gpsOriginRef.current.lon) * 111139;
    const altM = raw.gpsAlt - gpsOriginRef.current.alt;

    setCurrentData({
      ...raw,
      vx: velocityRef.current.x,
      vy: velocityRef.current.y,
      vz: velocityRef.current.z
    });

    setOrientation({ ...rotationRef.current });

    setHistory(prev => {
      return {
        time: [...prev.time, t],
        acc: {
          x: [...prev.acc.x, raw.ax],
          y: [...prev.acc.y, raw.ay],
          z: [...prev.acc.z, raw.az]
        },
        gyro: {
          x: [...prev.gyro.x, raw.gx],
          y: [...prev.gyro.y, raw.gy],
          z: [...prev.gyro.z, raw.gz]
        },
        vel: {
          x: [...prev.vel.x, velocityRef.current.x],
          y: [...prev.vel.y, velocityRef.current.y],
          z: [...prev.vel.z, velocityRef.current.z]
        },
        gps: {
          lat: [...prev.gps.lat, latM],
          lon: [...prev.gps.lon, lonM],
          alt: [...prev.gps.alt, altM]
        }
      };
    });
  };

  const renderValue = (label, value, unit = "") => (
    <div className="data-card">
      <span className="label">{label}</span>
      <span className="value">{value !== undefined ? value : "--"} <small>{unit}</small></span>
    </div>
  );

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) setModelUrl(URL.createObjectURL(file));
  };

  return (
    <div className="dashboard">
      <header>
        <h1>🚀 Ground Station</h1>
        <div className="controls" style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={connectSerial}
            disabled={isConnected || isSimulating}
            className={isConnected ? "connected" : "connect-btn"}
          >
            {isConnected ? "USB Connected" : "Connect Pico"}
          </button>
          <button
            onClick={startSimulation}
            disabled={isConnected}
            className={isSimulating ? "simulating-btn" : "sim-btn"}
            style={{ backgroundColor: isSimulating ? '#ff9800' : '#444', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
          >
            {isSimulating ? "Stop Sim" : "Simulate"}
          </button>
        </div>
      </header>

      <div className="main-layout">
        {/* LEFT PANEL */}
        <div className="data-panel">
          <h3>Telemetry Stream</h3>
          <div className="grid-container">
            <div className="divider">GPS</div>
            {renderValue("Lat", currentData.lat?.toFixed(4))}
            {renderValue("Lon", currentData.lon?.toFixed(4))}
            {renderValue("GNSS Time", currentData.gpsTime)}
            {renderValue("GNSS Alt", currentData.gpsAlt?.toFixed(2), "m")}
            {renderValue("GNSS Sats", currentData.sats)}

            <div className="divider">Acceleration</div>
            {renderValue("aX", currentData.ax?.toFixed(2))}
            {renderValue("aY", currentData.ay?.toFixed(2))}
            {renderValue("aZ", currentData.az?.toFixed(2))}

            <div className="divider">Gyroscope</div>
            {renderValue("gX", currentData.gx?.toFixed(1))}
            {renderValue("gY", currentData.gy?.toFixed(1))}
            {renderValue("gZ", currentData.gz?.toFixed(1))}

            <div className="divider">Velocity</div>
            {renderValue("vX", currentData.vx?.toFixed(2), "m/s")}
            {renderValue("vY", currentData.vy?.toFixed(2), "m/s")}
            {renderValue("vZ", currentData.vz?.toFixed(2), "m/s")}

          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="charts-panel">
          {/* ORIENTATION ROW - FORCED TO 200px HEIGHT */}
          <div className="orientation-row" style={{ height: '500px' }}>
            {/* MODEL WRAPPER - FORCED TO 400px WIDTH */}
            <div className="model-wrapper" style={{ width: '250px', flex: 'none' }}>
              <div className="chart-title">Live Orientation</div>
              <Canvas>
                <ambientLight intensity={0.9} />
                <pointLight position={[100, 100, 100]} />
                <Suspense fallback={<Loader />}>
                  {modelUrl ? <CustomRocket url={modelUrl} rotation={orientation} /> : <DefaultRocket rotation={orientation} />}
                </Suspense>
                <OrbitControls enableZoom={true} />
                <PerspectiveCamera makeDefault position={[0, 0, 50]} />
              </Canvas>
            </div>
            <div className="orientation-info">
              <div className="grid-container">
                {renderValue("Packet", currentData.packet)}
                {renderValue("Time", currentData.time, "s")}
                {renderValue("Alt", currentData.alt, "m")}
                {renderValue("Pressure", currentData.press, "hPa")}
                {renderValue("Temp", currentData.temp, "°C")}
              </div>
              <br></br>
              <div className="terminal-wrapper" style={{ height: '200px', backgroundColor: 'black', borderRadius: '8px', border: '1px solid #333', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div className="chart-title" style={{ position: 'static', padding: '5px 10px', backgroundColor: '#1f1f1f', borderBottom: '1px solid #333' }}>Raw Serial Data</div>
                {/* Applied ref here */}
                <div ref={terminalContentRef} style={{ flex: 1, overflowY: 'auto', padding: '10px', fontFamily: 'monospace', fontSize: '0.8rem', color: '#0f0' }}>
                  {rawLogs.map((log, i) => <div key={i}>{log}</div>)}
                </div>
              </div>
              <div className="upload-box">
                <input type="file" accept=".glb,.gltf" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
                <button className="upload-btn" onClick={() => fileInputRef.current.click()}>Upload 3D Model</button>
              </div>
            </div>
          </div>

          <div className="chart-grid">
            <div className="map-wrapper" style={{ height: '200px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #333', position: 'relative' }}>
              <MapContainer center={[18.5204, 73.8567]} zoom={15} style={{ height: '100%', width: '100%' }} attributionControl={false}>
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                <Marker position={[currentData.lat || 18.5204, currentData.lon || 73.8567]}>
                  <Popup>Current Location</Popup>
                </Marker>
                <RecenterMap lat={currentData.lat} lon={currentData.lon} />
              </MapContainer>
              <div className="chart-title" style={{ zIndex: 999 }}>Live GPS Map</div>
            </div>

            <Plot data={[{ type: 'scatter3d', mode: 'lines', x: history.gps.lat, y: history.gps.lon, z: history.gps.alt, line: { width: 6, color: history.gps.alt, colorscale: 'Viridis' } }]}
              layout={{ autosize: true, height: 200, title: '3D Trajectory', paper_bgcolor: 'rgba(0,0,0,0)', font: { color: "white" }, margin: { t: 30, b: 10, l: 10, r: 10 }, scene: { xaxis: { title: 'Lat', color: 'white' }, yaxis: { title: 'Lon', color: 'white' }, zaxis: { title: 'Alt', color: 'white' } } }} useResizeHandler={true} style={{ width: "100%" }} />

            {/* Graphs */}
            <Plot data={[{ x: history.time, y: history.acc.x, type: 'scatter', mode: 'lines', name: 'aX', line: { color: 'red' } }, { x: history.time, y: history.acc.y, type: 'scatter', mode: 'lines', name: 'aY', line: { color: 'green' } }, { x: history.time, y: history.acc.z, type: 'scatter', mode: 'lines', name: 'aZ', line: { color: 'blue' } }]}
              layout={{ autosize: true, height: 200, title: 'Acceleration', paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: "white" }, margin: { t: 30, b: 30, l: 30, r: 10 } }} useResizeHandler={true} style={{ width: "100%" }} />

            <Plot data={[{ x: history.time, y: history.gyro.x, type: 'scatter', mode: 'lines', name: 'gX', line: { color: 'red' } }, { x: history.time, y: history.gyro.y, type: 'scatter', mode: 'lines', name: 'gY', line: { color: 'green' } }, { x: history.time, y: history.gyro.z, type: 'scatter', mode: 'lines', name: 'gZ', line: { color: 'blue' } }]}
              layout={{ autosize: true, height: 200, title: 'Gyroscope', paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: "white" }, margin: { t: 30, b: 30, l: 30, r: 10 } }} useResizeHandler={true} style={{ width: "100%" }} />

            <Plot data={[{ x: history.time, y: history.vel.x, type: 'scatter', mode: 'lines', name: 'vX', line: { color: 'red' } }, { x: history.time, y: history.vel.y, type: 'scatter', mode: 'lines', name: 'vY', line: { color: 'green' } }, { x: history.time, y: history.vel.z, type: 'scatter', mode: 'lines', name: 'vZ', line: { color: 'blue' } }]}
              layout={{ autosize: true, height: 200, title: 'Velocity', paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: "white" }, margin: { t: 30, b: 30, l: 30, r: 10 } }} useResizeHandler={true} style={{ width: "100%" }} />

          </div>
        </div>
      </div>
    </div>
  );
};

export default App;