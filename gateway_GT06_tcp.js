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


const protocolGT06 = require('./ProtocolGT06');
//const bdados = require("./bdados");  //Adiciona arquivo de manipulação do Banco de Dados (MySql).
const net = require('net');
const fs = require('fs');
const cNumPort = 9006;

var server = net.createServer((socket) => {
   var gt06 = new protocolGT06('gt06');
   //console.log('Mais um equipamento conectado.');

   socket.on("error", (err) => {
      const fileName = 'log_gt06.txt';
      fs.writeFileSync(fileName, err.message, {flag: 'a+'});
      fs.writeFileSync(fileName, "\n----------------------------------------\n", {flag: 'a+'});
   });
  
   socket.on('data', (data) => {

      gt06.parse(data);
      
      if (gt06.msgBuffer.length > 0) {
         
         //Em algumas mensagens é preciso o servidor enviar uma resposta ao equipamento.
         //Nos casos de LOGIN, STATUS e RESPOSTA de comandos.
         if (gt06.expectsResponse) {
            socket.write(gt06.responseMsg);
         }      

         gt06.msgBuffer.forEach((msg, idx) => {
            console.log(idx.toString()+' - '+msg.rowLog);

            //Envio de comandos do servidor ao equipamento.
            //BLOQUEIO (RELAY,1#), DESBLOQUEIO (RELAY,0#), PEDIDO DE INFORMAÇÔES (WHERE#), ...
            if (msg.expectsCommand) {
               socket.write(msg.commandMsg);
            } 
         });

         //Atualiza o Banco de Dados, imprime arquivo de LOG's e cria
         //arquivo 123456789012345.txt na pasta './comandos' para ser enviado ao equipamento.
         //Fiz dessa forma porque uso 'promises' para atualizar e consultar informações no Banco de Dados.
         //Dessa forma o processo continua e não tem que esperar 'await'.
         //bdados.interacaoDBase(gt06.msgBuffer);  

      }
      
   });
});

// Vincula 'socket' ao endereço (0.0.0.0 - todos os IPs remotos) e porta 'cNumPort'.
server.listen(cNumPort, '0.0.0.0', () => {
  console.log('Gateway iniciado na porta:', cNumPort);
});