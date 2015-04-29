var express = require('express');
var bodyP = require('body-parser');
var mysql = require('mysql');
var twig = require("twig");
var session = require('express-session');
var evt = require('events');

var db    = mysql.createConnection({
  host     : process.env.IP,  //spécifique pour C9!
  user     : process.env.C9_USER.substr(0,16),
  password : '',
  database : 'c9'
});

var app = express();
//Configuration des middlewares
app.use(bodyP.urlencoded({ extended: false }));
app.use('/',express.static('static'));
app.set('views', 'templates');
app.use(session({ secret: '12345' }));


//************************VARIABLES GLOBALES******************/

//Struct. qui garde l'utilisateur qu'on regarde à l'instant précis
//(on reçoit les coordonnées de cet utilisateur)
var active_room = {}; 
//Struct. qui garde tous les utilisateurs qui nous regarde à l'instant précis
//(on envoie nos coordonnées à ces utilisateurs)  
var revactives_room={}; 
//Struct. qui contient les utilisateurs connectés (login, nom et une notification)
var onlineusers = {};
// On crée l'émetteur d'événements globale (on émettra un événement dedans à 
//chaque fois que le tableau des utilisateurs changera).
var global_emitter = new evt.EventEmitter();
global_emitter.on('userschanged',function(event){
    console.log('Users changed!');
    console.log(active_room);
});

//Fonction qui permettre d'activer ou désactiver une chambre
function activeordeactive (user1, user2){
    console.log('Users actives'+user1+' '+user2);
    //Si user1 regarde un autre utilisateur (par ex. user2) 
    //On demande à user2 d'arrêter d'envoyer ses coordonnées à user1
    //En supprimant le user1 du revactive_room du user2 
    //et le user1 arrête aussi de regarder le user2
    if(active_room[user1]){ 
        delete revactives_room[active_room[user1]][user1]; 
        console.log(user1);
        active_room[user1]=null; 
        onlineusers[user1].notif_emitter.emit("RoomDeactivated",1);
        console.log("RoomDeactivated");
    }
    //Si on a met en argument un user2 et le user1 voudrais le voir
    //On vérifie si le user2 n'a pas de reactive_room, 
    //si c'est le cas on va créer le reactive_room de user2
    //on ajoute user1 dans le reactive_room du user2 
    //(donc user2 va commencer à envoyer ces coordonnées à user1)
    if(user2){ 
        active_room[user1]=user2; 
        if(!revactives_room[user2])
            revactives_room[user2]={};
        revactives_room[user2][user1]=1;
        onlineusers[user1].notif_emitter.emit("RoomActivated",user2);
    }
}
  
///********************** GESTIONNAIRES **************************/    
//Gestionnaire qui renvoie à la page d'accueil 
app.all("/",function(req,res){
    res.render("start.twig");
});

//Gestionnaire qui reoriente vers la page principal du compte, en vérifiant qu'un login 
//et un mot de passe ont été inséres et envoyés.
//Après il utilise ces informations pour mettre à jour la variable globale (onlineusers) 
//et va faire aussi une notification globale en disant qu'un nouveau utilisateur est connecté
app.all("/signin",function(req,res){
    if (req.method!='POST') return renderform(null);
    if (!req.body.login) return renderform('Login missing');
    if (!req.body.password) return renderform('Password missing');
    db.query("SELECT login, nom FROM users WHERE login =? AND pass =?", [req.body.login, req.body.password], next1);
    //db.query("SELECT login, nom FROM users WHERE login ='"+req.body.login+"' AND pass ='"+req.body.password+"'",[], next1);
    return;
    function next1(err, result){
        if(err){
            console.log("Empty Signin");
            console.log(err);
        }
        if (result.length > 0){
            req.session.login = result[0].login;
            var user = req.session.login;
            onlineusers[user] = {login: user, nom: result[0].nom, notif_emitter: new evt.EventEmitter()};
            global_emitter.emit("userschanged", {login: user, nom: result[0].nom, status: 1});
            res.redirect('/account');
            return;
        }
    return renderform('Wrong login or pasword!, Please try again.');
    }
    
    function renderform(err){
        res.render("login.twig",{error: err});
    return 0;
    }
});

//Gestionnaire qui permettre de créer et garder dans la base de données un nouveau utilisateur
app.all("/signup",function(req,res) {
    if (req.method != 'POST') return renderform(null);
    if (!req.body.nom) return renderform('Name missing');
    if (!req.body.login) return renderform('Username missing');
    if (!req.body.password) return renderform('Password missing');
    
    var exp=new RegExp("^[a-zA-Z0-9]{1,8}$");
    if (!exp.test(req.body.login))
        return renderform("\n\nThis username ["+req.body.login+"] is not valide!!!!");
    
    db.query('INSERT INTO users(login,pass,nom) VALUES(?,?,?)', [req.body.login, req.body.password, req.body.nom], next1);
        return; 
    
    function next1(err, result){
        if (!err) {res.redirect('/signin'); return;}
        if (err.code == "ER_DUP_ENTRY")
            return renderform("This username already exists");
        //JSON.stringify convert une valeur (objet/tableau) JScript en une chaine Json
        return renderform("Unknown error" + JSON.stringify(err)); 
    }

    function renderform(err){
        res.render("signup.twig",{error: err});
    return 0; 
    }
});

//Gestionnaire qui gére la déconnexion d'un utilisateur depuis l'application.
app.get('/logout',function(req,res){
    var user1 = req.session.login;
    if(!user1) return res.redirect("/signin");
    //Le user2 ne pourra pas recevoir les coordonnées du user1
    for(var users in revactives_room[user1]){
        active_room[users] = null;
        onlineusers[users].notif_emitter.emit("RoomDeactivated"); 
    }    
    delete revactives_room[user1]; 
    
    //Le user2 va arrêter d'envoyer ses coordonnées à le user1
    var user2 = active_room[user1];
    if(user2){
        delete revactives_room[user2][user1];
    }
    delete active_room[user1]; 
    
    db.query('DELETE FROM authorisation WHERE user1=? OR user2=?', [user1, user1]);
    global_emitter.emit("userschanged",{login: user1, nom: onlineusers[user1].nom, status:0});
    delete onlineusers[user1]; 
    delete req.session.login;
    res.redirect("/signin");
    return;
});

//Gestionnaire qui renvoie à la page principal du compte du utilisateur.
app.get('/account',function(req,res){
    if (!req.session.login) {res.redirect('/signin'); return;}
    res.render('asynchrone.twig', {login: req.session.login});
});

//Gestionnaire qui gére l'état actuelle des utilisateurs connectés. 
//En envoyant les données utilisées par le navigateur: etat.myself, etat.viewuser, etat.connectedusers.
app.get('/api/currentstate',function(req,res){
    var user = req.session.login;
    if(!user) return res.json("You're not login, please connect first");
    var reps = {};
    reps.myself = {login: user, nom: onlineusers[user].nom}
    reps.connectedusers = {};
    for(var i in onlineusers){
        var u = onlineusers[i];
        reps.connectedusers[i] = {login: u.login, nom: u.nom, status: 1};
    }

    reps.viewuser = active_room[user]; //on initialise la variable de navigateur etat.viewuser
    //Base des données Authorisation a 2 status: 1(invité), 2(accepté)
    db.query("(SELECT user1 AS user, 3 AS stat FROM authorisation WHERE status = 1 AND user2=?)" //le user a envoyé une invitation à un autre utilisateur
    +" UNION (SELECT user2 AS user, 2 AS stat FROM authorisation WHERE status = 1 AND user1=?)" //le user a reçu une invitation
    +" UNION (SELECT user2 AS user, 4 AS stat  FROM authorisation WHERE status = 2 AND user1=?)",[user, user, user], verification); //le user a accepté.
        return;
    
        function verification(err, result){
            if(err){
                console.log("Error in the Current State")
                console.log(err);
            }
            for(var i in result){
                var r = result[i];
                console.log(r);
            //Dans le cas que le serveur a été démarré:
            //Si l'utilisateur existe, on mis à jour la variable du navigateur etat.connectedusers.status
            //On change justement son status(soit 0:non connectés, 1: connectés, 2: l'autre utilisateur a reçu une invitation, 
            //3: l'autre utilisateur a envoyé une inivtation, 4: accepté)
                if (reps.connectedusers[r.user]) 
                    reps.connectedusers[r.user].status = r.stat;
            }
        //On élimine le utilisateur qui est dans la session de la liste qui 
        //affiche les utilisateur connectés dans la page principal de son compte
        if (reps.connectedusers[user])
            delete reps.connectedusers[user]; 
    
        res.json(reps);
        return;
    }
});

//Gestionnaire qui gére la requête d'une invitation fait d'un utilisateur à autre,
//en s'assurant que les utilisateurs sont connectés et que aucune invitation entre le deux est déjà faite.
//Si c'est le cas, on insert dans la base de données Authorisation les 2 utilisateurs 
//avec un status=1 (qui signifie invité).
//Finalement, on met à jour la variable globale du navigateur etat.connectedusers en envoyant 
//un notif_emitter (qui contient le login, nom, et le status=2/3) à chaque utilisateur.
app.get('/api/invite',function(req,res){
    var user1 = req.session.login;
    var user2 = req.query.user;
    if(!user1) return res.json("You cant invite this person, please connect first");
    if(!user2 || !onlineusers[user2]) return res.json("This user doesn't exist or might be offline");
    db.query("SELECT status FROM authorisation WHERE (user1=? AND user2=?) OR (user2=? AND user1=?)" , [user1, user2, user1, user2], verification);
        return;
    
        function verification(err, result){
            if(err){
                res.json(err);
                return;
            }
            if (result.length>0){
                res.json("You've already invited this person");
                return;
            }
            db.query("INSERT INTO authorisation(user1, user2, status) VALUES(?,?,1)", [user1, user2], next1);
            return 0;
        }

        function next1(err, result){
            if(err){
                res.json(err);
                return;
            }
            onlineusers[user1].notif_emitter.emit("userschanged", {login: user2, nom:onlineusers[user2].nom, status: 2});
            onlineusers[user2].notif_emitter.emit("userschanged", {login: user1, nom:onlineusers[user1].nom, status: 3});
            res.json(null);
            return 0;
        }
});
    
//Gestionnaire qui gére la réponse positive d'une invitation fait d'un utilisateur à autre,
//en s'assurant que les utilisateurs sont connectés.
//Si c'est le cas, on met à jour dans la base de données Authorisation les 2 utilisateurs 
//avec un status=2 (qui signifie accepté) et aussi on insére l'inverse des utilisateurs user1 et user2 avec status=2.
//Finalement, on met à jour la variable globale de navigateur etat.connectedusers en envoyant 
//un notif_emitter (qui contient le login, nom, et le status=4) à chaque utilisateur.
app.get('/api/invitationyes',function(req,res){
    var user2 = req.session.login;
    var user1 = req.query.user;
    if(!user2) return res.json("You can't accept this invitation, please connect first");
    if(!user1 || !onlineusers[user1]) return res.json("This user doesn't exist or might be offline");
    db.query("UPDATE authorisation SET status=2 WHERE user1=? AND user2=? AND status=1", [user1, user2], next1);
        return;
        
        function next1(err,result){
            if(err){
                res.json(err);
                return;
            }
           
            if (result.affectedRows==0){
                console.log("You've never been Invited");
                res.json("You've never been Invited");
                return;
            }
                
            db.query("INSERT INTO authorisation(user1, user2, status) VALUES(?,?,2)", [user2, user1]);
            onlineusers[user1].notif_emitter.emit("userschanged", {login: user2, nom:onlineusers[user2].nom, status: 4});
            onlineusers[user2].notif_emitter.emit("userschanged", {login: user1, nom:onlineusers[user1].nom, status: 4});
             
            if(active_room[user1]==null){
                activeordeactive(user1, user2);
            }
            
            if(active_room[user2]==null){
                activeordeactive(user2, user1);
            }
             
            res.json(null);
            return 0;
        }
});
 
//Gestionnaire qui gére la réponse negative d'une invitation fait d'un utilisateur à autre,
//en s'assurant que les utilisateurs sont connectés.
//Si c'est le cas, on élimine dans la base de données Authorisation les 2 utilisateurs 
//avec un status=1 (qui signifie invité).
//Finalement, on met à jour la variable globale de navigateur etat.connectedusers en envoyant 
//un notif_emitter (qui contient le login, nom, et le status=1) à chaque utilisateur.
app.get('/api/invitationno',function(req,res) {
    var user2 = req.session.login;
    var user1 = req.query.user;
    if(!user2) return res.json("You can't refuse this invitation, please connect first");
    if(!user1 || !onlineusers[user2]) return res.json("This user doesn't exist or might be offline");
    db.query("DELETE FROM authorisation WHERE user1=? AND user2=? AND status = 1", [user1, user2], next1);
        return;
    
        function next1(err,result){
            if(err){
                res.json(err);
                return;
            }
            
            if (result.affectedRows==0){
                console.log("You've never been Invited");
                res.json("You've never been Invited");
                return;
            }
    
            onlineusers[user1].notif_emitter.emit("userschanged", {login: user2, nom:onlineusers[user2].nom, status: 1});
            onlineusers[user2].notif_emitter.emit("userschanged", {login: user1, nom:onlineusers[user1].nom, status: 1});
           
            res.json(null);
            return 0;
        }
});

//Gestionnaire qui gére la vue de la position GPS d'un utilisateur.,
//en s'assurant que les utilisateurs sont connectés et qu'ils sont dans la base de données
//authorisation avec status=2.
//Si c'est le cas, on utilise la fonction activeordeactive pour mettre le user2 
//dans l'active_room du user1 et aussi pour ajouter le user1 dans le revactive_room du user2.
app.get('/api/seelocation', function(req,res) {
    var user1 = req.session.login;
    var user2 = req.query.user;
    if (!user1) return res.json("You can't see this person's location, please connect first");
    if (!user2 || !onlineusers[user2]) return res.json("This user doesn't exist or might be offline");
    db.query("SELECT user1, user2 FROM authorisation WHERE user1=? AND user2=? AND status=2", [user1, user2], next1);
        return;
        function next1(err, result){
            if(err){
                console.log("Error in seelocation");
                console.log(err);
                res.json(err);
                return;
            }
        
            if(result.length > 0){
                activeordeactive(user1, user2);
                res.json(null);
                return;
            }
        
            if(result.length == 0){                           
                console.log("Access Denied, please invite this person first");
                res.json("Access Denied, please invite this person first");
                return;
            }
        }
});

//Gestionnaire qui gére la fin de la transimission de données GPS entre 2 utilisateurs,
//en s'assurant que les utilisateurs sont connectés.
//Après on élimine de la base de données la ligne qui contient ces 2 utilisateurs avec status=2 (et aussi l'inverse).
//Finalement, on met à jour la variable globale de navigateur etat.connectedusers en envoyant 
//un notif_emitter (qui contient le login, nom, et le status=1) à chaque utilisateur.
//Et on utilise la fonction activeordeactive pour éliminer le user2 
//du active_room/revactive_room du user1 et viceversa.
app.get('/api/finish',function(req,res) {
    var user1 = req.session.login;
    var user2 = req.query.user;
    if(!user1) return res.json("You can't finish this session, please connect first");
    if(!user2 || !onlineusers[user2]) return res.json("This user doesn't exist or might be offline");       
    db.query("DELETE FROM authorisation WHERE user1=? AND user2=? AND status=2", [user1, user2], next2);
        return;
        function next2(err,result){
            if(err){
                console.log("Session not well ended");
                console.log(err);
                res.json(err);
                return;
            }
            
            if (result.affectedRows==0){
                console.log("You've never been Invited");
                 res.json("You've never been Invited");
                return;
            }
            
            db.query("DELETE FROM authorisation WHERE user1=? AND user2=? AND status=2", [user2, user1]);
            onlineusers[user1].notif_emitter.emit("userschanged", {login: user2, nom:onlineusers[user2].nom, status: 1});
            onlineusers[user2].notif_emitter.emit("userschanged", {login: user1, nom:onlineusers[user1].nom, status: 1});
            
            delete revactives_room[user1][user2];
            delete revactives_room[user2][user1];
            if(active_room[user1]==user2)
                active_room[user1]=null;
            if(active_room[user2]==user1)
                active_room[user2]=null;
            //activeordeactive(user1, null);
            //if(active_room[user2]==user1)
                //activeordeactive(user2, null);
            
            res.json(null);
            return 0;
        }
});

//Gestionnaire qui arréte le fait de voir de la position GPS d'un utilisateur,
//en utilisant la fonction activeordeactive pour éliminer le active_room du 
//utilisateur qui est dans la session et sort du seelocation.
app.get('/api/exit',function(req,res){
    activeordeactive(req.session.login,null);
    return res.json(null);
});

//Gestionnaire qui gére la transimission de données GPS entre 2 utilisateurs,
////en s'assurant que le user1 est connecté.
//Finalement, on envoie les données GPS du user1 à tous les autres utilisateur qui sont 
//dans sont revactive_room avec un notif_emitter.
app.get('/api/position',function(req,res) {
    var user1 = req.session.login;
    if(!user1) return res.json("You can't send your position, please connect first");
    var position = {latitude: req.query.latitude, longitude: req.query.longitude};
    console.log('/api/position '+JSON.stringify(revactives_room[user1]));
    for (var user2 in revactives_room[user1]){
        console.log("sending GPS position: "+JSON.stringify({user1: user1, user2:user2, position: position}));
        onlineusers[user2].notif_emitter.emit("GPSposition", position); 
    } 
    res.json(null);
});

//Gestionnaire qui gére tous les notifications qui sont envoiés au navigateur.
app.get('/api/notification',function(req,res){
    var user = req.session.login;
    if(!user) return res.send(500,"Not authorized");
        
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    res.writeHead(200);
    var callback = function(event){
            res.write('event: userschanged\n'); 
            res.write('data: '+JSON.stringify(event)+'\n\n');
        }
    global_emitter.on("userschanged", callback);
    
    var callback1 = function(event){
        res.write('event: userschanged\n');
        res.write('data: '+JSON.stringify(event)+'\n\n'); 
    }
    onlineusers[user].notif_emitter.on("userschanged", callback1);
    
    var callback2 = function(event){
        res.write('event: RoomActivated\n');
        res.write('data: '+JSON.stringify(event)+'\n\n');
    }
    onlineusers[user].notif_emitter.on("RoomActivated", callback2);
    
    var callback3 = function(event){
        res.write('event: RoomDeactivated\n');
        res.write('data: '+JSON.stringify(event)+'\n\n');
    }
    onlineusers[user].notif_emitter.on("RoomDeactivated", callback3);
    
    var callback4 =function(event){
        res.write('event: GPSposition\n');
        res.write('data: '+JSON.stringify(event)+'\n\n');
    }
    onlineusers[user].notif_emitter.on("GPSposition", callback4);
    
    //On ferme tous les événements, pour qu'on ne charge pas le serveur avec des événements.
    req.on("close", function(){
        global_emitter.removeListener("userschanged",callback);
        if (onlineusers[user]){
            onlineusers[user].notif_emitter.removeListener("userschange", callback1);
            onlineusers[user].notif_emitter.removeListener("RoomActivated", callback2);
            onlineusers[user].notif_emitter.removeListener("RoomDeactivated", callback3);
            onlineusers[user].notif_emitter.removeListener("GPSposition", callback4);
        }
    });
});

    
app.listen(8080);