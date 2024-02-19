//=======================================================================================================
// Esse SCRIPT foi pego em: https://github.com/vondraussen/gt06
// Mais informações sobre o protocolo em:
// https://www.traccar.org/protocols/
// https://dl.dropboxusercontent.com/s/sqtkulcj51zkria/GT06_GPS_Tracker_Communication_Protocol_v1.8.1.pdf
//
// EU FIZ ALGUMAS ALTERAÇÕES, COMPLETEI O QUE FALTAVA E INCLUIR 
// COMENTÁRIOS EXPLICATIVOS SOBRE O PROTOCOLO.
//
// CVidalMO: Carlos Vidal M. O.
// Data....: Fevereiro de 2024.
// WhatsApp: (85) 9 8402-3820.
// Github..: https://github.com/cvidalmo.
// E-mails.: cvidalmo@gmail.com, cvidalmo@yahoo.com, cvidalmo@hotmail.com.
//=======================================================================================================


const getCrc16 = require('./crc16');  //Adiciona arquivo de teste CRC16.
const fs = require('fs');

const cStrUnknown = 'DESCONHECIDO'; 
const cStrLogin = 'LOGIN';
const cStrLocation = 'TRACK';
const cStrStatus = 'STATUS';
const cStrString = 'RESPOSTA';
const cStrAlarm = 'ALARME';
const cStrGPS = 'GPS';
const cStrCommand = 'COMANDO';

const cStrNormalAlarm = 'NENHUM';
const cStrShockAlarm = 'COLISÃO';
const cStrPowerCutAlarm = 'CORTE ALIMT.';
const sStrLowBatteryAlarm = 'CARGA BATERIA';
const cStrSOSAlarm = 'AJUDA';

const cStrTrue = 'LIG.';
const cStrFalse = 'DESL.';

const cStrNoSignal = '0%~1%';  //SEM SINAL / no signal.
const cStrExtWeakSignal = '2%~9%';  //MUITO BAIXO / extremely weak signal.
const cStrVeryWeakSignal = '10%~49%';  //BAIXO / very weak signal.
const cStrGoodSignal = '50%~79%';  //BOM / good signal.
const cStrStrongSignal = '80%~100%';  //ALTO / strong signal.

const cStrNoPowerBattery = '0%';  //SEM CARGA / No Power (shutdown).
const cStrExtLowBattery = '5%';  //DESCARREGADA / Extremely Low Battery (not enough for calling or sending text messages, etc.).
const cStrVeryLowBattery = '10%';  //MUITO BAIXA / Very Low Battery (Low Battery Alarm).
const cStrLowBattery = '20%';  //BAIXA / Low Battery (can be used normally).
const cStrMediumBattery = '50%';  //MEDIA / Medium.
const cStrHighBattery = '80%';  //ALTA / High.
const cStrVeryHighBattery = '100%'  //COMPLETA / Very High.


module.exports = protocolGT06 = function (typeDevice) {
   this.msgBufferRaw = new Array();
   this.msgBuffer = new Array();
   this.imei = null;
   this.typeDevice = typeDevice.toLowerCase();  //'gt06' ou 'nt20'.
}


// Se várias mensagens estiverem no buffer, ele as armazenará em 'msgBufferRaw', 
// o estado da última mensagem será representado em Gt06.
protocolGT06.prototype.parse = function (data) {
   
   this.msgBuffer.length = 0; 
   this.msgBufferRaw.length = 0;  
   this.msgBufferRaw = sliceMsgsInBuff(data).slice();
   
   //Loop caso venha mais de uma mensagem juntas do mesmo equipamento.
   this.msgBufferRaw.forEach((msg, idx, msgBufferRaw) => {  //msg = data[].
         
      //Checa se os dados que chegaram estão íntegros.
      if (checkData(msg, idx, msgBufferRaw)) {
         
         //O 'login' faz com que 'this.imei' seja guardado, caso não tenha passado pelo 'login', 'this.imei' será null.
         //Aqui testa se é o 'login' ou se passou antes pelo 'login' (this.imei != null).
         if (msg[3] == 0x01 || this.imei != null) { 

            switch (msg[3]) {  //msg[3] -> Protocol Number.
               case 0x01:  //01 - login / Login Message.
                  this.msgBuffer.push(parseLogin(msg));
                  break;
               case 0x12:  //18 - track (localização) / Location Data.
                  this.msgBuffer.push(parseLocation(msg, this.imei));
                  break;
               case 0x13:  //19 - status / Status information.
                  this.msgBuffer.push(parseStatus(msg, this.imei, this.typeDevice));
                  break;
               case 0x15:  //21 - resposta do equipamento para o envio feito usando o valor 0x80 / String information.
                  this.msgBuffer.push(parseString(msg, this.imei));
                  break;
               case 0x16:  //22 - alarme / Alarm data.
                  this.msgBuffer.push(parseAlarm(msg, this.imei, this.typeDevice));
                  break;
               case 0x1A:  //26 - gps / GPS, query address information by phone number.
                  this.msgBuffer.push(parseGPS(msg, this.imei));
                  break;

               //case 0x80:  //128 - Valor 0x80, será usado para enviar comandos para o equipamento. function createCommand...
               //            //Command information sent by the server to the terminal.
               //   break;
            }

            //Verifica se existe algum comando para ser enviado ao equipameno.
            //O comando a ser enviado, deve ser gravado em um arquivo com nome '<IMEI>.txt', nas pasta '.\comandos'.
            let fileName = './comandos/'+this.imei+'.txt';
            //Se existir o arquivo.
            if (fs.existsSync(fileName)){
               const dataFile = fs.readFileSync(fileName);  //Pega o comando que está dentro do arquivo.
               fs.unlinkSync(fileName);  //Apagar o arquivo. Pois tem que ser um comando por vez.
               this.msgBuffer.push(createCommand(dataFile, this.imei, false));
            }
         }
      }
   }); 
   
   if (this.msgBuffer.length > 0) {
      //Aqui grava uma mensagem no objeto 'this', de preferência que 'expectsResponse: true',
      //ou seja, que tenha confirmação de recebimento (Heartbeat).
      //Para ser usado no gateway que chamou o método 'parse' desse arquivo.
      
      //A sequência de verificação é a mesma que foi gravada. LOGIN, SATUS e RESPOSTA.
      const idx = this.msgBuffer.map(e => e.expectsResponse).indexOf(true);
      //Se não encontrar, pega a última mensagem.
      if (idx < 0) {
         Object.assign(this, this.msgBuffer[this.msgBuffer.length-1]);
      } else {
         Object.assign(this, this.msgBuffer[idx]);
      }
   }
}


//Checa se os dados estão íntegros.
function checkData(msg, idx, data) {
   
   //Verifica cabeçalho.
   const header = msg.slice(0, 2);
   if (!header.equals(Buffer.from('7878', 'hex'))) {
      return false;
   }
   
   //Verifica protocolo, msg[3] -> Protocol Number.
   if (',1,18,19,21,22,26,'.indexOf(','+msg[3].toString()+',') == -1) {
      //console.log('Verifica protocolo: '+msg[3].toString());
      return false;
   }
   
   //Verifica se informações estão replicadas.
   if (idx > 0) {
      if (Buffer.compare(msg, data[idx - 1]) == 0) {
         return false;
      }
   }
   
   //Verifica se a mensagem está completa e integra, testando o 'Error Check'.
   const dataString = msg.toString();
   msg.writeUInt16BE(getCrc16(msg.slice(2, msg.length - 4)).readUInt16BE(0), msg.length - 4);
   if (dataString != msg.toString()) {
      return false;
   }
   
   return true;
}


//Pega o evento referente ao protocolo da mensagem (Protocol Number).
function selectEvent(data) {
   let eventStr = cStrUnknown;  //Unknown.
   
   //data[0] e data[1] = Start Bit (78 78 = x x).
   //data[2] = Packet Length.
   switch (data[3]) { //Protocol Number.
      case 0x01:  //01 em decimal.
         eventStr = cStrLogin;  //Login
         break;
      case 0x12:  //18 em decimal.
         eventStr = cStrLocation;  //Location.
         break;
      case 0x13:  //19 em decimal.
         eventStr = cStrStatus;  //Status.
         break;
      case 0x15:  //21 em decimal.
         eventStr = cStrString;  //String. 
         break;         
      case 0x16:  //22 em decimal.
         eventStr = cStrAlarm;  //Alarm.
         break;
      case 0x1A:  //26 em decimal.
         eventStr = cStrGPS;  //GPS.
         break;
      case 0x80:  //128 em decimal.
         eventStr = cStrCommand;  //Command.
         break;         
      default:
         eventStr = cStrUnknown;  //Unknown.
         break;
   }
   return { number: data[3], hexa: '0x'+data[3].toString(16), description: eventStr };
}


//----------------------------------------------------------------------------------------------------------
//5.1. Login Message Packet.
//5.1.1. Terminal Sending Data Packet to Server.
//       The login message packet is used to be sent to the server with the terminal ID so as to confirm the
//       established connection is normal or not.
//----------------------------------------------------------------------------------------------------------
function parseLogin(data) {
   //Login Message, Packet (18 Bytes): data[0] ao data[17].
   //
   //data[0] e data[1]: Start Bit (78 e 78 = x e x).
   //data[2]: Packet Length.
   //data[3]: Protocol Number.
   let imei = parseInt(data.slice(4, 12).toString('hex'), 10);  //data[4] ao data[11]: Terminal ID.
   let serialNumber = data.readUInt16BE(12);  //data[12] e data[13] (readUInt16BE = 2 bytes): Information Serial Number.
   return {
      expectsResponse: true,  //Usado para confirmar recebimento dos dados.
      expectsCommand: false,  //Usado para enviar comandos ao equipamento.
      responseMsg: createResponse(data),
      event: selectEvent(data),
      parseTime: Date.now(),
      imei: imei,
      serialNumber: serialNumber,
      rowLog: 'LOGIN, '+imei+', SERIAL:'+serialNumber
      //errorCheck: data.readUInt16BE(14)  //data[14] e data[15] (readUInt16BE = 2 bytes): Error Check.
   };
   //data[16] e data[17]: Stop Bit.
}


//------------------------------------------------------------------------
//5.2. Location Data Packet (combined information package of GPS and LBS).
//5.2.1. Terminal Sending Location Data Packet to Server.
//------------------------------------------------------------------------
function parseLocation(data, imei) {
   //Location Message, Packet (36 Byte): data[0] ao data[35].
   //
   let datasheet = { 
      startBit: data.readUInt16BE(0),  //data[0] e data[1]: Start Bit (78 e 78 = x e x).
      protocolLength: data.readUInt8(2),  //data[2]: Packet Length.
      protocolNumber: data.readUInt8(3),  //data[3]: Protocol Number.
      fixTime: data.slice(4, 10),  //data[4] ao data[9]: Date Time.
      quantity: data.readUInt8(10),  //data[10]: Quantity of GPS information satellites.
      latitude: data.readUInt32BE(11),  //data[11] ao data[14] (readUInt32BE = 4 bytes): Latitude.
      longitude: data.readUInt32BE(15),  //data[15] ao data[18] (readUInt32BE = 4 bytes): Longitude.
      speed: data.readUInt8(19),  //data[19]: Speed.
      course: data.readUInt16BE(20),  //data[20] e data[21] (readUInt16BE = 2 bytes): Course, Status.
      mcc: data.readUInt16BE(22),  //data[22] e data[23] (readUInt16BE = 2 bytes): MCC - Mobile Country Code.
      mnc: data.readUInt8(24),  //data[24]: MNC - Mobile Network Code.
      lac: data.readUInt16BE(25),  //data[25] e data[26] (readUInt16BE = 2 bytes): LAC - Location Area Code.
      cellId: parseInt(data.slice(27, 30).toString('hex'), 16),  //data[27] ao data[29]: Cell ID.
      serialNr: data.readUInt16BE(30),  //data[30] e data[31] (readUInt16BE = 2 bytes): Serial Number.
      errorCheck: data.readUInt16BE(32)  //data[32] e data[33] (readUInt16BE = 2 bytes): Error Check.
   };
   //data[34] e data[35]: Stop Bit.

   let dadosRealCache = Boolean(datasheet.course & 0x2000) ? 'T.REAL' : 'CACHE';  //realTimeGps - True or False.
   let gpsConectado = Boolean(datasheet.course & 0x1000) ? 'CONECT.' : 'DESCON.';  //gpsPositioned - True or False.
   
   let parsed = {
      expectsResponse: false,  //Usado para confirmar recebimento dos dados.
      expectsCommand: false,  //Usado para enviar comandos ao equipamento.
      responseMsg: '',
      event: selectEvent(data),
      parseTime: Date.now(),
      fixTime: parseDatetime(datasheet.fixTime).toISOString().substring(0, 19).replace('T',' '),
      fixTimestamp: parseDatetime(datasheet.fixTime).getTime()/1000,
      satCnt: (datasheet.quantity & 0xF0) >> 4,
      satCntActive: (datasheet.quantity & 0x0F),
      latitude: decodeGt06Lat(datasheet.latitude, datasheet.course),
      longitude: decodeGt06Lon(datasheet.longitude, datasheet.course),
      speed: datasheet.speed,
      speedUnit: 'km/h',
      realTimeGps: Boolean(datasheet.course & 0x2000),
      gpsPositioned: Boolean(datasheet.course & 0x1000),
      eastLongitude: !Boolean(datasheet.course & 0x0800),
      northLatitude: Boolean(datasheet.course & 0x0400),
      course: (datasheet.course & 0x3FF),
      mcc: datasheet.mcc,  
      mnc: datasheet.mnc,  
      lac: datasheet.lac,  
      cellId: datasheet.cellId,
      serialNr: datasheet.serialNr,
      errorCheck: datasheet.errorCheck,
      imei: imei,
      rowLog: 'TRACK, '+imei+', SERIAL:'+datasheet.serialNr+', '+parseDatetime(datasheet.fixTime).toISOString().substring(0, 19).replace('T',' ')+
         ', '+decodeGt06Lat(datasheet.latitude, datasheet.course)+', '+decodeGt06Lon(datasheet.longitude, datasheet.course)+
         ', '+datasheet.speed+'km/h, '+(datasheet.course & 0x3FF)+'°, DADOS GPS:'+dadosRealCache+', GPS:'+gpsConectado+
         ', SATELITES:'+(datasheet.quantity & 0x0F)
   };
   return parsed;

}


//-----------------------------------------------------------------
//5.3. Alarm Packet (GPS, LBS, combined status information packet).
//5.3.1. Server Sending Alarm Data Packet to Server.
//-----------------------------------------------------------------
function parseAlarm(data, imei, device) { 
   //Alarm Message, Packet (42 Byte): data[0] ao data[41].
   let datasheet = {
      startBit: data.readUInt16BE(0),  //data[0] e data[1]: Start Bit (78 e 78 = x e x).                      >> 2
      protocolLength: data.readUInt8(2),  //data[2]: Packet Length.                                           >> 1
      protocolNumber: data.readUInt8(3),  //data[3]: Protocol Number.                                         >> 1
      fixTime: data.slice(4, 10),  //data[4] ao data[9]: Date Time.                                           >> 6
      quantity: data.readUInt8(10),  //data[10]: Quantity of GPS information satellites.                      >> 1
      latitude: data.readUInt32BE(11),  //data[11] ao data[14] (readUInt32BE = 4 bytes): Latitude.            >> 4
      longitude: data.readUInt32BE(15),  //data[15] ao data[18] (readUInt32BE = 4 bytes): Longitude.          >> 4
      speed: data.readUInt8(19),  //data[19]: Speed.                                                          >> 1
      course: data.readUInt16BE(20),  //data[20] e data[21] (readUInt16BE = 2 bytes): Course, Status.         >> 2
      lbs: data.readUInt8(22),  //data[22]: LBS - Location Based Services.                                    >> 1
      mcc: data.readUInt16BE(23),  //data[23] e data[24] (readUInt16BE = 2 bytes): MCC - Mobile Country Code. >> 2
      mnc: data.readUInt8(25),  //data[25]: MNC - Mobile Network Code.                                        >> 1
      lac: data.readUInt16BE(26),  //data[26] e data[27] (readUInt16BE = 2 bytes): LAC - Location Area Code.  >> 2
      cellId: parseInt(data.slice(28, 31).toString('hex'), 16),  //data[28] ao data[30]: Cell ID.             >> 3
      statusInfo: data.slice(31, 34),  //data[31] ao data[33]: Status Information.                            >> 3 (111)
      alarmLang: data.readUInt16BE(34), //data[34] e data[35]: Alarm/Language.                                >> 2
      serialNr: data.readUInt16BE(36),  //data[36] e data[37] (readUInt16BE = 2 bytes): Serial Number.        >> 2
      errorCheck: data.readUInt16BE(38)  //data[38] e data[39] (readUInt16BE = 2 bytes): Error Check.         >> 2
   };                                    //data[40] e data[41]: Stop Bit.                                     >> 2

   let terminalInfo = datasheet.statusInfo.slice(0, 1).readUInt8(0);  //data[31]: Terminal Information Content.
   let voltageLevel = datasheet.statusInfo.slice(1, 2).readUInt8(0);  //data[32]: Voltage Level.
   let gsmSigStrength = datasheet.statusInfo.slice(2, 3).readUInt8(0);  //data[33]: GSM Signal Strength.

   let alarmType = cStrNormalAlarm;  //Normal.
   let alarm = (terminalInfo & 0x38) >> 3;  //data[31]: Terminal Information Content.
   switch (alarm) {
      case 1:
         alarmType = cStrShockAlarm;  //Shock Alarm.
         break;
      case 2:
         alarmType = cStrPowerCutAlarm;  //Power Cut Alarm.
         break;
      case 3:
         alarmType = sStrLowBatteryAlarm;  //Low Battery Alarm.
         break;
      case 4:
         alarmType = cStrSOSAlarm;  //SOS.
         break;
      default:
         alarmType = cStrNormalAlarm;  //Normal.
         break;
   }

   let termObj = {
      status: Boolean(terminalInfo & 0x01) ? cStrTrue : cStrFalse,  //True or False.
      ignition: Boolean(terminalInfo & 0x02) ? cStrTrue : cStrFalse,  //True or False.
      alarmType: alarmType,
      charging: Boolean(terminalInfo & 0x04) ? cStrTrue : cStrFalse,  //True or False.
      gpsTracking: Boolean(terminalInfo & 0x40) ? 'T.REAL' : 'CACHE',  //Tempo real ou cache / //True or False.
      relayState: Boolean(terminalInfo & 0x80) ? cStrTrue : cStrFalse  //True or False.
   }

   let voltageLevelStr = cStrNoPowerBattery;  //SEM CARGA / No Power (shutdown).
   switch (voltageLevel) {  //data[32]: Voltage Level.
      case 1:
         voltageLevelStr = cStrExtLowBattery;  //DESCARREGADA / Extremely Low Battery (not enough for calling or sending text messages, etc.).
         break;
      case 2:
         voltageLevelStr = cStrVeryLowBattery;  //MUITO BAIXA / Very Low Battery (Low Battery Alarm).
         break;
      case 3:
         voltageLevelStr = cStrLowBattery;  //BAIXA / Low Battery (can be used normally).
         break;
      case 4:
         voltageLevelStr = cStrMediumBattery;  //MEDIA / Medium.
         break;
      case 5:
         voltageLevelStr = cStrHighBattery;  //ALTA / High.
         break;
      case 6:
         voltageLevelStr = cStrVeryHighBattery;  //COMPLETA / Very High.
         break;
      default:
         voltageLevelStr = cStrNoPowerBattery;  //SEM CARGA / No Power (shutdown).
          break;
   }
   
   let gsmSigStrengthStr = cStrNoSignal;  //SEM.SINAL / no signal.
   if (device == 'gt06') {
      switch (gsmSigStrength) {  //data[33]: GSM Signal Strength.
         case 1:
            gsmSigStrengthStr = cStrExtWeakSignal;  //MUITO BAIXO / extremely weak signal.
            break;
         case 2:
            gsmSigStrengthStr = cStrVeryWeakSignal;  //BAIXO / very weak signal.
            break;
         case 3:
            gsmSigStrengthStr = cStrGoodSignal;  //BOM / good signal.
            break;
         case 4:
            gsmSigStrengthStr = cStrStrongSignal;  //ALTO / strong signal.
            break;
         default:
            gsmSigStrengthStr = cStrNoSignal;  //SEM SINAL / no signal.
            break;
      }
   } else {  //nt20.
      gsmSigStrengthStr = gsmSigStrength.toString()+'%';
   }
   
   let parsed = {
      expectsResponse: true,  //Usado para confirmar recebimento dos dados.
      expectsCommand: false,  //Usado para enviar comandos ao equipamento.
      responseMsg: createResponse(data),
      event: selectEvent(data),
      parseTime: Date.now(),      
      fixTime: parseDatetime(datasheet.fixTime).toISOString().substring(0, 19),
      fixTimestamp: parseDatetime(datasheet.fixTime).getTime()/1000,
      satCnt: (datasheet.quantity & 0xF0) >> 4,
      satCntActive: (datasheet.quantity & 0x0F),
      latitude: decodeGt06Lat(datasheet.latitude, datasheet.course),
      longitude: decodeGt06Lon(datasheet.longitude, datasheet.course),
      speed: datasheet.speed,
      speedUnit: 'km/h',
      realTimeGps: Boolean(datasheet.course & 0x2000),
      gpsPositioned: Boolean(datasheet.course & 0x1000),
      eastLongitude: !Boolean(datasheet.course & 0x0800),
      northLatitude: Boolean(datasheet.course & 0x0400),
      course: (datasheet.course & 0x3FF),
      lbs: datasheet.lbs,  
      mcc: datasheet.mcc,  
      mnc: datasheet.mnc,  
      lac: datasheet.lac,  
      cellId: datasheet.cellId,
      terminalInfo: termObj,
      voltageLevel: voltageLevelStr,
      gpsSignal: gsmSigStrengthStr,
      alarmLang: datasheet.alarmLang,
      serialNr: datasheet.serialNr,
      errorCheck: datasheet.errorCheck,
      imei: imei,
      rowLog: 'ALARME, '+imei+', SERIAL:'+datasheet.serialNr+', ALARME:'+termObj.alarmType+', BLOQUEIO:'+termObj.relayState+
            ', ALIMENTACAO:'+termObj.charging+', IGNICAO:'+termObj.ignition+', BATERIA:'+voltageLevelStr+
            ', GPS:'+termObj.gpsTracking+', GSM:'+gsmSigStrengthStr
   };

   return parsed;

}


//------------------------------------------------------------------------------------------------------
//5.4. Heartbeat Packet (status information packet).
//     Heartbeat packet is a data packet to maintain the connection between the terminal and the server.
//5.4.1. Terminal Sending Heartbeat Packet to Server.
//------------------------------------------------------------------------------------------------------
function parseStatus(data, imei, device) {
   //Status Message, Packet (15 Byte): data[0] ao data[14].
   //
   //data[0] e data[1]: Start Bit (78 e 78 = x e x).                          >> 2
   //data[2]: Packet Length.                                                  >> 1
   //data[3]: Protocol Number.                                                >> 1
   //data[4] ao data[6]: Status Information.                                  >> 3 (111)
   let statusInfo = data.slice(4, 7);  
   //data[7] e data[8]: Alarm/Language.                                       >> 2
   //data[9] e data[10] (readUInt16BE = 2 bytes): Information Serial Number.  >> 2   
   let serialNumber = data.readUInt16BE(9);  
   //data[11] e data[12]: Error Check.                                        >> 2
   //data[13] e data[14]: Stop Bit.                                           >> 2

   let terminalInfo = statusInfo.slice(0, 1).readUInt8(0);  //data[4]: Terminal Information Content.  
   let voltageLevel = statusInfo.slice(1, 2).readUInt8(0);  //data[5]: Voltage Level.
   let gsmSigStrength = statusInfo.slice(2, 3).readUInt8(0);  //data[6]: GSM Signal Strength.

   let alarmType = cStrNormalAlarm;  //Normal.
   let alarm = (terminalInfo & 0x38) >> 3;  //data[4]: Terminal Information Content.
   switch (alarm) {
      case 1:
         alarmType = cStrShockAlarm;  //Shock Alarm.
         break;
      case 2:
         alarmType = cStrPowerCutAlarm;  //Power Cut Alarm.
         break;
      case 3:
         alarmType = cStrLowBatteryAlarm;  //Low Battery Alarm.
         break;
      case 4:
         alarmType = cStrSOSAlarm;  //SOS.
         break;
      default:
         alarmType = cStrNormalAlarm;  //Normal.
         break;
   }

   let termObj = {
      status: Boolean(terminalInfo & 0x01) ? cStrTrue : cStrFalse,  //True or False.
      ignition: Boolean(terminalInfo & 0x02) ? cStrTrue : cStrFalse,  //True or False.  
      alarmType: alarmType,
      charging: Boolean(terminalInfo & 0x04) ? cStrTrue : cStrFalse,  //True or False.
      gpsTracking: Boolean(terminalInfo & 0x40) ? 'T.REAL' : 'CACHE',  //Tempo real ou cache / //True or False.
      relayState: Boolean(terminalInfo & 0x80) ? cStrTrue : cStrFalse  ////True or False.
   }

   let voltageLevelStr = cStrNoPowerBattery;  //SEM CARGA / No Power (shutdown).
   switch (voltageLevel) {  //data[32]: Voltage Level.
      case 1:
         voltageLevelStr = cStrExtLowBattery;  //DESCARREGADA / Extremely Low Battery (not enough for calling or sending text messages, etc.).
         break;
      case 2:
         voltageLevelStr = cStrVeryLowBattery;  //MUITO BAIXA / Very Low Battery (Low Battery Alarm).
         break;
      case 3:
         voltageLevelStr = cStrLowBattery;  //BAIXA / Low Battery (can be used normally).
         break;
      case 4:
         voltageLevelStr = cStrMediumBattery;  //MEDIA / Medium.
         break;
      case 5:
         voltageLevelStr = cStrHighBattery;  //ALTA / High.
         break;
      case 6:
         voltageLevelStr = cStrVeryHighBattery;  //COMPLETA / Very High.
         break;
      default:
         voltageLevelStr = cStrNoPowerBattery;  //SEM CARGA / No Power (shutdown).
          break;
   }

   let gsmSigStrengthStr = cStrNoSignal;  //SEM.SINAL / no signal.
   if (device == 'gt06') {
      switch (gsmSigStrength) {  //data[6]: GSM Signal Strength.
         case 1:
            gsmSigStrengthStr = cStrExtWeakSignal;  //MUITO BAIXO / extremely weak signal.
            break;
         case 2:
            gsmSigStrengthStr = cStrVeryWeakSignal;  //BAIXO / very weak signal.
            break;
         case 3:
            gsmSigStrengthStr = cStrGoodSignal;  //BOM / good signal.
            break;
         case 4:
            gsmSigStrengthStr = cStrStrongSignal;  //ALTO / strong signal.
            break;
         default:
            gsmSigStrengthStr = cStrNoSignal;  //SEM SINAL / no signal.
            break;
      }
   } else {  //nt20.
      gsmSigStrengthStr = gsmSigStrength.toString()+'%';
   }

   return {
      expectsResponse: true,  //Usado para confirmar recebimento dos dados.
      expectsCommand: false,  //Usado para enviar comandos ao equipamento.
      responseMsg: createResponse(data),
      event: selectEvent(data),
      parseTime: Date.now(),
      terminalInfo: termObj,
      voltageLevel: voltageLevelStr,
      gsmSigStrength: gsmSigStrengthStr,
      imei: imei,
      rowLog: 'STATUS, '+imei+', SERIAL:'+serialNumber+', ALARME:'+termObj.alarmType+', BLOQUEIO:'+termObj.relayState+
            ', ALIMENTACAO:'+termObj.charging+', IGNICAO:'+termObj.ignition+', BATERIA:'+voltageLevelStr+
            ', GPS:'+termObj.gpsTracking+', GSM:'+gsmSigStrengthStr
   };
   
}


//---------------------------------------------
//vi. Data Packet Sent From Server to Terminal.
//6.1. Packet Sent by Server.
//---------------------------------------------
function createCommand(command, imei, create) {
   // Command Message.
   
   if (create) {
      // 1: (2) Start Bit (0x78 e 0x78 = 120 e 120 em decimal = x e x).
      // 2: (1) Packet Length (Tamanho mensagem = 12 + M Bytes, Conteúdo do 'command' é de comprimento variável). 
      // 3: (1) Protocol Number (0x80 = 128 em decimal = Ç). 
      // 4: (1) Length of Command (Tamanho conteúdo do 'command').
      // 5: (4) Server Flag Bit (Identificação do servidor. Será retornado na mensagem 0x15).
      // 6: (M) Command Content (Conteúdo da mensagem 'command').
      // 7: (2) Language (0x00 e 0x01 = 0 e 1 em decimal = chines).
      // 8: (2) Information Serial Number (Número sequencial de mensagens enviadas para cada equipamento, DEXEI FIXO 01).
      // 9: (2) Error Check (0x0 e 0x0 = 0 e 0 em decimal). Ao executar '...getCrc16(...', será trocado pelo CRC correto;
      //10: (2) Stop Bit (0x0d e 0x0a = 13 e 10 em decimal ).
      
      // 12 = 1............ + 2............ + 2.......... + 1................ + 4.............. + 2.......
      //      Packet Length   Serial Number   Error Check   Length of Command   Server Flag Bit   Language.
      let sizeCommand = 12 + command.length;  //command.length é variável.
    
      //                             1.......  2..........  3..  4.............   5...  6......                     7...  8...  9...  10....
      let send = String.fromCharCode(120, 120, sizeCommand, 128, command.length)+"1234"+command+String.fromCharCode(0, 1, 0, 1, 0, 0, 13, 10);
      let bufferSend = Buffer.from(send); 
      
      // A função 'getCrc16' está em './crc16'.
      // Grava o crc16 na 4ª posição da direita (2 bytes) os dois últimos bytes são o final da linha.
      bufferSend.writeUInt16BE(getCrc16(bufferSend.slice(2, bufferSend.length - 4)).readUInt16BE(0), bufferSend.length - 4);

      return {
         expectsResponse: false,  //Usado para confirmar recebimento dos dados.
         expectsCommand: true,  //Usado para enviar comandos ao equipamento.
         responseMsg: '',
         event: selectEvent(bufferSend),
         parseTime: Date.now(),
         lengthString: command.length,
         strinContext: command,
         serialNumber: '01',
         imei: imei,
         rowLog: 'COMANDO, '+imei+', SERIAL: 01, '+command.length+' letras, '+command,
         commandMsg: bufferSend
      };
      
   } else {
      return {
         expectsResponse: false,  //Usado para confirmar recebimento dos dados.
         expectsCommand: true,  //Usado para enviar comandos ao equipamento.
         responseMsg: '',
         event: selectEvent(command),
         parseTime: Date.now(),
         lengthString: command.readUInt8(4),
         strinContext: command.slice(9, command.length - 8).toString(),
         serialNumber: '01',
         imei: imei,
         rowLog: 'COMANDO, '+imei+', SERIAL: 01, '+command.readUInt8(4)+' letras, '+command.slice(9, command.length - 8).toString(),
         commandMsg: command
      };
   }
}


//---------------------------------------------
//vi. Data Packet Sent From Server to Terminal.
//6.2. Packet Replied by Terminal
//---------------------------------------------
function parseString(data, imei) {
   // String Message (RESPOSTA).
   
   //data[0] e data[1]: Start Bit (78 e 78 = x e x).  >> 0, 1
   //data[2]: Packet Length.                          >> 2
   //data[3]: Protocol Number.                        >> 3
   let lengthCommand = data.readUInt8(4);  //data[4]: Length of Command.         >> 4
   let serverFlagBit = data.slice(5, 9);  //data[5] ao data[8]: Server Flag Bit. >> 5, 6, 7, 8,
   let commandContext = data.slice(9, data.length - 8).toString();  //Command Content.      >> 9 ...
                                                             //data[?] e data[?](readUInt16BE = 2 bytes): Language.     >> 2
   let serialNumber = data.readUInt16BE(data.length - 6);  //data[?] e data[?](readUInt16BE = 2 bytes): Serial Number.  >> 2
   //let errorCheck = data.readUInt16BE(11 + lengthCommand);  //data[?] e data[?](readUInt16BE = 2 bytes): Error Check. >> 2
   //data[?] e data[?]: Stop Bit.  >> 2
   commandContext = commandContext.replace(String.fromCharCode(13, 10), ' ').trim();
   
   return {
      expectsResponse: true,  //Usado para confirmar recebimento dos dados.
      expectsCommand: false,  //Usado para enviar comandos ao equipamento.
      responseMsg: createResponse(data),
      event: selectEvent(data),
      parseTime: Date.now(),
      lengthString: lengthCommand,
      strinContext: commandContext,
      serialNumber: serialNumber,
      imei: imei,
      rowLog: 'RESPOSTA, '+imei+', SERIAL:'+serialNumber+', '+commandContext.length+' letras, '+commandContext
   }

}


//-------------------------------------------------------------------
//6.7. GPS, Phone Number Querying Address Information Package (0X1A).
//6.7.1. Information from Terminal to Server.
//-------------------------------------------------------------------
function parseGPS(data, imei) {
   // GPS Message, Packet (51 Byte): data[0] ao data[50].
   let datasheet = {
      startBit: data.readUInt16BE(0),  //data[0] e data[1]: Start Bit (78 e 78 = x e x).
      protocolLength: data.readUInt8(2),  //data[2]: Packet Length.
      protocolNumber: data.readUInt8(3),  //data[3]: Protocol Number.
      fixTime: data.slice(4, 10),  //data[4] ao data[9]: Date Time.
      quantity: data.readUInt8(10),  //data[10]: Quantity of GPS information satellites.
      latitude: data.readUInt32BE(11),  //data[11] ao data[14] (readUInt32BE = 4 bytes): Latitude.
      longitude: data.readUInt32BE(15),  //data[15] ao data[18] (readUInt32BE = 4 bytes): Longitude.
      speed: data.readUInt8(19),  //data[19]: Speed.
      course: data.readUInt16BE(20),  //data[20] e data[21] (readUInt16BE = 2 bytes): Course, Status.
      phoneNumber: data.slice(22, 43),  //data[22] ao data[42]: Phone Number.
      language: data.readUInt16BE(43),  //data[43] e data[44] (readUInt16BE = 2 bytes): Language.
      serialNr: data.readUInt16BE(45),  //data[45] e data[46] (readUInt16BE = 2 bytes): Serial Number.
      errorCheck: data.readUInt16BE(47)  //data[47] e data[48] (readUInt16BE = 2 bytes): Error Check.
   };
   //data[49] e data[50]: Stop Bit.
   
   let dadosRealCache = Boolean(datasheet.course & 0x2000) ? 'T.REAL' : 'CACHE';  //realTimeGps - True or False.
   let gpsConectado = Boolean(datasheet.course & 0x1000) ? 'CONECT.' : 'DESCON.';  //gpsPositioned - True or False.
   
   let parsed = {
      expectsResponse: false,  //Usado para confirmar recebimento dos dados.
      expectsCommand: false,  //Usado para enviar comandos ao equipamento.
      responseMsg: '',
      event: selectEvent(data),
      parseTime: Date.now(),
      fixTime: parseDatetime(datasheet.fixTime).toISOString().substring(0, 19),
      fixTimestamp: parseDatetime(datasheet.fixTime).getTime()/1000,
      latitude: decodeGt06Lat(datasheet.latitude, datasheet.course),
      longitude: decodeGt06Lon(datasheet.longitude, datasheet.course),
      speed: datasheet.speed,
      speedUnit: 'km/h',
      realTimeGps: Boolean(datasheet.course & 0x2000),
      gpsPositioned: Boolean(datasheet.course & 0x1000),
      eastLongitude: !Boolean(datasheet.course & 0x0800),
      northLatitude: Boolean(datasheet.course & 0x0400),
      course: (datasheet.course & 0x3FF),
      phoneNumber: datasheet.phoneNumber,
      serialNr: datasheet.serialNr,
      errorCheck: datasheet.errorCheck,
      imei: imei,
      rowLog: 'GPS, '+imei+', SERIAL:'+datasheet.serialNr+', FONE:'+datasheet.phoneNumber+
         ', '+parseDatetime(datasheet.fixTime).toISOString().substring(0, 19).replace('T',' ')+
         ', '+decodeGt06Lat(datasheet.latitude, datasheet.course)+', '+decodeGt06Lon(datasheet.longitude, datasheet.course)+
         ', '+datasheet.speed+'km/h, '+(datasheet.course & 0x3FF)+'°, DADOS GPS:'+dadosRealCache+', GPS:'+gpsConectado+
         ', SATELITES:'+(datasheet.quantity & 0x0F)    
   };
}


//----------------------------------------
// 5.1.2. Server Responds the Data Packet.
//----------------------------------------
function createResponse(data) {
   let respRaw = Buffer.from('787805FF0001d9dc0d0a', 'hex');
   
   // Coloca na posição FF do 'respRaw' o 'Protocol Number' da mensagem recebida,
   // que será enviada na mensagem de resposta.
   respRaw[3] = data[3];
   appendCrc16(respRaw);
   return respRaw;
}


function parseDatetime(data) { 
   let dateTrack = new Date(Date.UTC(data[0] + 2000, data[1] - 1, data[2], data[3], data[4], data[5]));
   let dateNow = new Date();  
   dateNow.setHours( dateNow.getHours() - 3);  //Fuso horário de Brasília.
   
   //Se no equipamento não estiver configurado o 'time zone' para -3 horas.
   //Se a data do 'track' for maior que a data atual, diminue 3 horas na data do 'track'.
   if (dateTrack > dateNow) {
      dateTrack.setHours( dateTrack.getHours() - 3);
   }
   return dateTrack;
}


function decodeGt06Lat(lat, course) {
   var latitude = lat / 60.0 / 30000.0;
   if (!(course & 0x0400)) {
      latitude = -latitude;
   }
   return Math.round(latitude * 1000000) / 1000000;
}


function decodeGt06Lon(lon, course) {
   var longitude = lon / 60.0 / 30000.0;
   if (course & 0x0800) {
      longitude = -longitude;
   }
   return Math.round(longitude * 1000000) / 1000000;
}


function appendCrc16(data) {
   //       2.........5 -4
   // 78 78 05 FF 00 01 d9 dc 0d 0a
   //       
   // A função 'getCrc16' esta em './crc16'.
   // Grava o crc16 na 4ª posição da direita (2 bytes) os 4 últimos bytes são o final da linha.
   data.writeUInt16BE(getCrc16(data.slice(2, 6)).readUInt16BE(0), data.length - 4);
}


function sliceMsgsInBuff(data) {
   let startPattern = new Buffer.from('7878', 'hex');
   let nextStart = data.indexOf(startPattern, 2);
   let msgArray = new Array();

   if (nextStart === -1) {
      msgArray.push(new Buffer.from(data));
      return msgArray;
   }
   msgArray.push(new Buffer.from(data.slice(0, nextStart)));
   let redMsgBuff = new Buffer.from(data.slice(nextStart));

   while (nextStart != -1) {
      nextStart = redMsgBuff.indexOf(startPattern, 2);
      if (nextStart === -1) {
         msgArray.push(new Buffer.from(redMsgBuff));
         return msgArray;
      }
      msgArray.push(new Buffer.from(redMsgBuff.slice(0, nextStart)));
      redMsgBuff = new Buffer.from(redMsgBuff.slice(nextStart));
   }
   return msgArray;
}


//---[ FIM ]----------------------------------------------------------