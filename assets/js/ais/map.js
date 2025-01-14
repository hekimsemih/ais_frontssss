//<-- Imports
import "../../css/map.sass"
import 'ol/ol.css';

import {Map, View, Feature} from 'ol';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import Stamen from 'ol/source/Stamen';
import GeoJSON from 'ol/format/GeoJSON';
import Renderer from './CustomRenderer.js';

import {defaults as defaultInteractions, DragRotateAndZoom} from 'ol/interaction';
import {RegularShape, Fill, Style, Stroke, Text} from 'ol/style';
import Point from 'ol/geom/Point';

import MousePosition from 'ol/control/MousePosition';
import {defaults as defaultControls} from 'ol/control';
import {createStringXY} from 'ol/coordinate';
import {fromLonLat} from 'ol/proj';

import sync from 'ol-hashed';
//-->
//<--Global variables
const mousePositionControl = new MousePosition({
    coordinateFormat: createStringXY(4),
    projection: 'EPSG:4326',
    // comment the following two lines to have the mouse position
    // be placed within the map.
    className: 'custom-mouse-position',
    target: document.getElementById('mouse-position'),
    undefinedHTML: '&nbsp;'
});

const shipLabelText = new Text({
    text: "None",
    textAlign: 'center',
    textBaseline: 'middle',
    offsetY: 30,
    backgroundFill: new Fill({
        color: [255, 255, 255]
    }),
    backgroundStroke: new Stroke({
        width: 1
    }),
    padding: [5,5,5,5]
});
const shipLabelPoint = new Point(fromLonLat([0,0]));
const shipLabel = new Feature({
    geometry: shipLabelPoint,
    name: 'ship label',
});
shipLabel.setStyle(
    new Style({
        text: shipLabelText
    })
);
const shipLabelLayer = new VectorLayer({
    source: new VectorSource({
        features: [shipLabel]
    })
});

const view = new View({
    center: fromLonLat([0, 0]),
    zoom: 2
});

const map = new Map({
    controls: defaultControls().extend([mousePositionControl]),
    interactions: defaultInteractions().extend([
        new DragRotateAndZoom()
    ]),
    view: view
});

const webglSource = new VectorSource({
    format: new GeoJSON(),
    // url: 'http://192.168.8.157:8600/geoserver/ais/wms?service=WMS&version=1.1.1&request=GetMap&layers=ais%3Ashipinfos&bbox=-180.0%2C-90.0%2C180.0%2C90.0&width=768&height=384&srs=EPSG%3A4326&format=geojson&time=PT5M/PRESENT',
    // url: 'data/geojson/ais.json',
    url: window.location.origin + '/api/ships?view=large_map',
    crossOrigin: 'anonymous',
});

const hoveredArrayBuffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT);
const hoveredFeature = new DataView(hoveredArrayBuffer);
hoveredFeature.setInt32(0,-1);

const selectedArrayBuffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT);
const selectedFeature = new DataView(selectedArrayBuffer);
selectedFeature.setInt32(0,-1);
let selectedMmsi = -1;
//-->
//<-- Functions

// update selected ship
function highlightShip(mmsi){
    selectedFeature.setInt32(0, mmsi);
    selectedMmsi = mmsi;
}

// show ship panels and highlight selected ship
function showShip(mmsi){
    shipinfos.dispatchEvent(changeinfosEvent({mmsi: mmsi}));
    panels.dispatchEvent(showpanelEvent({panel_id: "shipinfos"}));
    highlightShip(mmsi);
}

// jump to coordinate at zoom level
function jumpto(coordinates, zoom){
    let position = fromLonLat(coordinates)
    if (zoom)
        view.animate({zoom: zoom, center: position});
    else
        view.animate({center: position});
}

// Need refinement
let oldCoordinates = [0,0];
let oldMmsi = -1;
// action when mouseover search results: highlight and jump to ship
function overSearchResult(coordinates, mmsi){
    oldMmsi = selectedMmsi;
    oldCoordinates = view.getCenter();
    highlightShip(mmsi);
    jumpto(coordinates);
}
let debouncedTimeout = null;
// overSearchResult with a slight delay
function debouncedOverSearchResult(coordinates, mmsi) {
    if (debouncedTimeout) clearTimeout(debouncedTimeout);
    debouncedTimeout = setTimeout(function(){overSearchResult(coordinates, mmsi)}, 200);
}
// action when mouseout of search results
function outSearchResult(){
    highlightShip(oldMmsi);
    jumpto(oldCoordinates);
}

//-->
//<--Liveview hooks
const lvs = window.liveSocket;
// lvs.enableDebug()

const maploadedEvent = () => { return new CustomEvent("maploaded") };
let mapElt = null;
lvs.hooks.LoadMap = {
    mounted(){
        mapElt = this.el;
        loadMap();
        this.el.addEventListener("maploaded", (e) => {
            this.pushEvent("maploaded", {});
        });
        mousePositionControl.setMap(map);
        shipsInView();
    },
    updated(){
        map.setTarget(document.getElementById("map"));
        map.setTarget("map");
        mousePositionControl.setMap(map);
        shipsInView();
    }
};

const showpanelEvent = (detail) => { return new CustomEvent("showpanel", {detail: detail}) };
const hidepanelEvent = (detail) => { return new CustomEvent("hidepanel", {detail: detail}) };
let panels = null;
lvs.hooks.PanelVisibility = {
    mounted(){
        panels = this.el;
        this.el.addEventListener("showpanel", (e) => {
            this.pushEvent("showpanel", e.detail);
        });
        this.el.addEventListener("hidepanel", (e) => {
            this.pushEvent("hidepanel", e.detail);
        });
    }
};
const changeinfosEvent = (detail) => { return new CustomEvent("changeinfos", {detail: detail}) };
let shipinfos = null;
lvs.hooks.ChangeInfos = {
    mounted(){
        shipinfos = this.el;
        this.el.addEventListener("changeinfos", (e) => {
            this.pushEventTo("#shipinfos > .panel-content", "changeinfos", e.detail);
        });
    }
};
//-->
//<-- Webgl attributes

// /!\ TODO: Duplicate with css stylesheet here
// See comments below for a potential alternative /!\
const color_dict = {
    special: "#FF00E0",
    cargo: "#FF8700",
    wing: "#00FFC3",
    sailing: "#00C4FF",
    unspecified: "#969696",
    highspeed: "#A200C8",
    pleasure: "#00FF25",
    fishing: "#0002FF",
    tanker: "#D6DD1C",
    tug: "#A1660D",
    sar: "#FF001D",
    other: "#E0E0E0",
    passenger: "#388122"
}
function color_to_int(color){
    const [r,g,b] = [
        color.slice(1,3),
        color.slice(3,5),
        color.slice(5,7)
    ].map(x => parseInt(x,16));
    let res = 0;
    res |= r << 16;
    res |= g << 8;
    res |= b << 0;
    return res;
}
// function rgb_from_style(type){
//     let elem = document.querySelector('.ship-icon.'+type);
//     let rgb = window.getComputedStyle(elem).getPropertyValue('fill');
//     rgb = rgb.slice(4,-1).split(', ').map(val => parseInt(val));
//     return rgb;
// }
// const color_dict = {
//     special: rgb_from_style("special"),
//     cargo: rgb_from_style("cargo"),
//     wing: rgb_from_style("wing"),
//     sailing: rgb_from_style("sailing"),
//     unspecified: rgb_from_style("unspecified"),
//     highspeed: rgb_from_style("highspeed"),
//     pleasure: rgb_from_style("pleasure"),
//     fishing: rgb_from_style("fishing"),
//     tanker: rgb_from_style("tanker"),
//     tug: rgb_from_style("tug"),
//     sar: rgb_from_style("sar"),
//     other: rgb_from_style("other"),
//     passenger: rgb_from_style("passenger")
// }
// console.log(color_dict);
// function color_to_int(color){
//     const [r,g,b] = color;
//     let res = 0;
//     res |= r << 16;
//     res |= g << 8;
//     res |= b << 0;
//     return res;
// }


// We need size, angle, color, shape to properly draw a ship
const customLayerAttributes = [{
    name: 'size',
    callback: function (feature) {
        return 30;
    },
    notForTemplates: true,
},{
    name: 'iscircle',
    callback: function (feature) {
        const sog = feature.get('sog');
        const heading = feature.get('heading');

        if (sog < 0.5 || heading == 511)
            return true;
        return false;
    },
    toFragment: true,
},{
    name: 'id',
    callback: function (feature) {
        const b = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT);
        const dv = new DataView(b,0);
        dv.setInt32(0, parseInt(feature.getId()));
        return dv.getFloat32(0);
    },
    toFragment: true,
},{
    name: 'angle',
    callback: function (feature) {
        return feature.get('heading')*Math.PI/180;
    }
},{
    name: 'color',
    callback: function (feature) {
        const type = feature.get('type');
        const color = color_dict[type];
        return color_to_int(color);
    },
    toFragment: true,
}
];
const customLayerAttributeArrays = [];
//-->
//<-- Webgl uniforms
function numTwoFloats(num){
    const significantDigits = 6;

    const sign = Math.sign(num);
    const sciRep = Math.abs(num).toExponential();
    const [mantissa, exponent] = sciRep.split('e');
    const significant = mantissa.replace('.','');
    const [first, second] = [significant.slice(0,significantDigits), significant.slice(significantDigits, 2*significantDigits)];
    const firstMantissa = first.slice(0,1) + '.' + first.slice(1) + '0';
    const secondMantissa = second.slice(0,1) + '.' + second.slice(1) + '0';
    const secondExponent = Number(exponent) - significantDigits;

    const firstFloat = sign * Number(firstMantissa + 'e' + exponent);
    const secondFloat = sign * Number(secondMantissa + 'e' + secondExponent);

    return [firstFloat, secondFloat];
}
const uniforms = {
    u_hoveredId: function(framestate){
        return hoveredFeature.getFloat32(0);
    },
    u_selectedId: function(framestate){
        return selectedFeature.getFloat32(0);
    },
    u_eyepos: function(framestate){
        const center = framestate.viewState.center;
        const xs = numTwoFloats(center[0]);
        const ys = numTwoFloats(center[1]);
        return [xs[0], ys[0]];
    },
    u_eyeposlow: function(framestate){
        const center = framestate.viewState.center;
        const xs = numTwoFloats(center[0]);
        const ys = numTwoFloats(center[1]);
        return [xs[1], ys[1]];
    },
    u_projTransform: function(framestate){
        const size = framestate.size;
        const rotation = framestate.viewState.rotation;
        const resolution = framestate.viewState.resolution;
        const center = framestate.viewState.center;
        const sx = 2 / (resolution * size[0]);
        const sy = 2 / (resolution * size[1]);
        const dx2 = -center[0];
        const dy2 = -center[1];
        const sin = Math.sin(-rotation);
        const cos = Math.cos(-rotation);

        const transform = new Array(6);
        transform[0] = sx * cos;
        transform[1] = sy * sin;
        transform[2] = - sx * sin;
        transform[3] = sy * cos;
        transform[4] = 0;
        transform[5] = 0;

        return transform;
    },
    u_zoom: function(framestate){
        return framestate.viewState.zoom;
    }
};
//-->
//<--Shader promises
function fetchShader(url) {
    return fetch(url).then(response => response.text())
}
const vertexShader = fetchShader('/shaders/ais.vert');
const fragmentShader = fetchShader('/shaders/ais.frag');
const hitVertexShader = fetchShader('/shaders/hitais.vert');
const hitFragmentShader = fetchShader('/shaders/hitais.frag');
//-->
//<--Map

function shipsInView(){
    const extent = map.getView().calculateExtent(map.getSize());
    const shipcount = document.getElementById("shipcount");
    shipcount.innerHTML = `${webglSource.getFeaturesInExtent(extent).length} ships in view`;
}

function loadMap(){
    Promise.all([
        vertexShader,
        fragmentShader,
        hitVertexShader,
        hitFragmentShader
    ]).then(function(results){
        return {
            vertex: results[0],
            fragment: results[1],
            hitvertex: results[2],
            hitfragment: results[3],
        }
    }).then(function(results){

        //<-- Layers
        class CustomLayer extends VectorLayer{
            createRenderer() {
                const options = {
                    attributes: customLayerAttributes,
                    uniforms: uniforms,
                    vertexShader:  results.vertex,
                    fragmentShader: results.fragment,
                    hitVertexShader:  results.hitvertex,
                    hitFragmentShader: results.hitfragment,
                };
                // console.log(options.hitVertexShader);
                // console.log(options.hitFragmentShader);
                return new Renderer(this, options);
            }
        }
        const webglLayer = new CustomLayer({
            source: webglSource,
        });
        const webglError = webglLayer.getRenderer().getShaderCompileErrors();
        if (webglError) {
            console.log(webglError)
        }

        const osmLayer = new TileLayer({
            source: new OSM()
        });
        const stamenLayer = new TileLayer({
            source: new Stamen({layer: "toner"})
        });
        //-->

        // map.addLayer(osmLayer);
        map.addLayer(stamenLayer);
        map.addLayer(webglLayer);
        map.addLayer(shipLabelLayer);
        map.setTarget("map");

        //<-- map events
        map.on('click', function(evt) {
            highlightShip(-1);
            map.forEachFeatureAtPixel(evt.pixel, function(feature) {
                const mmsi = feature.getId();
                highlightShip(mmsi);
                showShip(mmsi);
                return true;
            }, {
                layerFilter: function(layer){
                    return layer.ol_uid == webglLayer.ol_uid;
                },
            });
        });
        map.on('pointermove', function(evt) {
            hoveredFeature.setInt32(0,-1);
            shipLabelLayer.setVisible(false);
            map.forEachFeatureAtPixel(evt.pixel, function(feature) {
                hoveredFeature.setInt32(0, parseInt(feature.getId()));
                shipLabelPoint.setCoordinates(feature.getGeometry().getCoordinates());
                shipLabelText.setText(feature.get('description'));
                shipLabelLayer.setVisible(true);

                return true;
            }, {
                layerFilter: function(layer){
                    return layer.ol_uid == webglLayer.ol_uid;
                },
            });
            map.render();
        });

        map.on('moveend', function(evt){
            shipsInView();
        });

        var sourceEventListener = webglSource.on('change', function(e) {
            if (webglSource.getState() == 'ready') {
                mapElt.dispatchEvent(maploadedEvent()); // hitting the server... really worth it?
                webglSource.un('change', sourceEventListener);
            }
        });
        //-->

        sync(map);
    });
}
//-->

window.showShip = showShip;
window.jumpto = jumpto;
window.debouncedOverSearchResult = debouncedOverSearchResult;
window.outSearchResult = outSearchResult;

// vim: set foldmethod=marker foldmarker=<--,--> :
