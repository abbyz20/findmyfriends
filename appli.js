var express = require('express');
var bodyP = require('body-parser');
//var cookieP = require('cookie-parser');
var mysql = require('mysql');
var twig = require("twig");
var session = require('express-session');
var evt = require('events');


var db    = mysql.createConnection({
  host     : process.env.IP,  // pas touche à ça: spécifique pour C9!
  user     : process.env.C9_USER.substr(0,16),  // laissez comme ça, ou mettez
                                                // votre login à la place
  password : '',
  database : 'c9'  // mettez ici le nom de la base de données
});


var app = express();

// Configuration des middlewares
app.use(bodyP.urlencoded({ extended: false }));
//app.use(cookieP()); 
//app.use(express.static('.'));
app.set('views', 'templates');
app.use(session({ secret: '12345' }));



var active_room = {}; //des clients qui sont dans une chambre au moins
var revactives_room={};  
var connectes = {
        "Michel": {login: "Michel", nom: "Michael Juarez", notif_emitter:new evt.EventEmitter()},
        "Mariya": {login: "Mariya", nom: "Mariya Campos", notif_emitter:new evt.EventEmitter()},
        "Jessica": {login: "Jessica", nom: "Jessica Benitez", notif_emitter:new evt.EventEmitter()}
};

// On crée l'émetteur d'événements (on émettra un événement dedans à chaque fois 
// que le tableau des utilisateurs changera).

var global_emitter = new evt.EventEmitter();
global_emitter.on('userschanged',function(event){
    console.log('users changed!');
    console.log(active_room);
});

    
app.all("/",function(req,res) {
    res.render("start.twig");
});

app.all("/signin",function(req,res) {
    if (req.method!='POST') return renderform(null);
        if (!req.body.login) return renderform('Login missing');
        if (!req.body.password) return renderform('Password missing');
    

    db.query("SELECT login, nom FROM users WHERE login =? AND pass =?", [req.body.login, req.body.password], next1);
    return;
    function next1(err, result){
        console.log(err);
        if (result.length > 0){
            req.session.login = result[0].login;
            connectes[req.session.login] = result[0]; //partie 6.1
            global_emitter.emit("userschanged"); // partie 7.1
            res.redirect('/account');
            return;
        }
    return renderform('Mauvais login/mot de passe');
    }
    
    function renderform(err) {
      res.render("login.twig",{error: err});
      return 0;
    }
});

app.all("/signup",function(req,res) {
    if (req.method != 'POST') return renderform(null);
    
    if (!req.body.nom) return renderform('nom absent');
    if (!req.body.login) return renderform('login absent');
    if (!req.body.password) return renderform('password absent');
    
    var exp=new RegExp("^[a-zA-Z0-9]{1,8}$");
    if (! exp.test(req.body.login))
        return renderform(" E R R E U R !\n\nLe login ["+req.body.login+"] n'est pas valide !!!!");
    db.query('INSERT INTO users(login,pass,nom) VALUES(?,?,?)', [req.body.login, req.body.password, req.body.nom], next1);
    return; 

    function next1(err, result){
        
        if (!err) {res.redirect('/signin'); return;}
        if (err.code == "ER_DUP_ENTRY")
            return renderform("Ce login existe deja");
        return renderform("une erreur etrange est survenue" + JSON.stringify(err));
    }

    function renderform(err) {
      res.render("signup.twig",{error: err});
      return 0; }
    });

app.get('/logout',function(req,res){
    var user = req.session.login;
    
    for(var users in revactives_room[user]){ //tu me vois pass
        active_room[users]=null;
    // envoyer un message au utilisateur pour le dire que le user c'est deco envoyer un eventemetter
    }    
    
    delete revactives_room[user]; 
    var user2 = active_room[user];
    if(user2){//dont send me anything!
        delete revactives_room[user2][user];
    }
    
    delete active_room[user]; 
    db.query('DELETE FROM authorisation WHERE user1=? OR user2=?', [user, user]);
    

    global_emitter.emit("userschanged",{login: user, nom: connectes[user].nom, status:0}); // partie 7.1 - ServerPush
    delete connectes[user]; //partie 6.1 - AJAX
    delete req.session.login;
    res.redirect("/signin");
    return;
});


app.get('/account',function(req,res){
    if (!req.session.login) {res.redirect('/signin'); return;}
    res.render('asynchrone.twig', {login: req.session.login});
});


app.get('/api/currentstate',function(req,res) {
    var user = req.session.login;
    var reps = {};
    reps.myself = {login: user, nom: connectes[user].nom}
    reps.connectedusers = {};
    for(var i in connectes){
        var u = connectes[i];
        reps.connectedusers[i] = {login: u.login, nom: u.nom, status : 1};
    }
    
    reps.view = active_room[user];
    
    db.query("(SELECT user1 AS user, 3 AS stat FROM authorisation WHERE status = 1 AND user2=?)"
    +" UNION (SELECT user2 AS user, 2 AS stat FROM authorisation WHERE status = 1 AND user1=?)"
    +" UNION (SELECT user2 AS user, 4 AS stat  FROM authorisation WHERE status = 2 AND user1=?)",[user, user, user], verification);
        return;
    
    function verification(err, result) {
        console.log(err);
            for(var i in  result){
                var r = result[i];
                reps.connectedusers[r.user].status = r.stat;
            }
    
    res.json(reps);
    return;
    }
});


app.get('/api/invite',function(req,res) {
    
    db.query("INSERT INTO authorisation(user1, user2, status) VALUES(?,?,?)", [req.session.login, req.query.user,1], next1);
        return;

    function next1(err, result){
        if (!err) {
            global_emitter.emit("invitation");
            return;
        }
        if (err.code == "ER_DUP_ENTRY")
            return renderform("Ce invitation c'est deja fait");
        return renderform("une erreur etrange est survenue" + JSON.stringify(err));
    }

    function renderform(err) {
      res.render("asynchrone.twig",{error: err});
      return 0;
    }
});
    
    
app.get('/api/invitationyes',function(req,res) {
    
    db.query("SELECT user1, user2 FROM authorisation WHERE user1=? AND user2=?", [req.query, req.session.login], next1);
        return;

    function next1(err, result){
        console.log(err);
        if(result.length > 0){ 
            db.query("UPDATE FROM authorisation SET status=2 WHERE user1=? AND user2=?", [req.session.login, req.query]);
        active_room[result.user1]=result.user2;
        revactives_room[result.user2]=result.user1;
                //res.write('event: notification\n'); 
                //res.write('data: '+JSON.stringify(chambresactives)+'\n\n');
            global_emitter.emit("notification");
            return;
        }
    }
});
 
   
app.get('/api/invitationno',function(req,res) {
    db.query("DELET user1, user2 FROM authorisation WHERE user1=? AND user2=?", [req.query, req.session.login]);
});


app.get('/api/finish',function(req,res) {
    db.query("SELECT user1, user2 FROM authorisation WHERE user1=? AND user2=?", [req.query, req.session.login], next1);
        return;

    function next1(err, result){
        console.log(err);
        if(result.length > 0){
            db.query("DELET user1, user2 FROM authorisation WHERE user1=? AND user2=?", [req.query, req.session.login]);
            active_room[req.query]=null;
            delete revactives_room[req.session.login][req.query];
            if(active_room[req.session.login]==req.query)
                active_room[req.session.login]=null;        
        
            global_emitter.removeListener("notification", function(event){
                res.write('event: notification\n'); 
                res.write('data: '+JSON.stringify(active_room)+'\n\n');   
            });
        return;
        }
    }
});

app.get('/api/exit',function(req,res){
    active_room[req.session.login]=null;
    delete revactives_room[req.query][req.session.login];
    return;
});

app.get('/api/seelocation', function(req,res) {
    
    db.query("SELECT user2 FROM authorisation WHERE user2=? AND status=2", [req.query], next1);
        return;

    function next1(err, result){
        console.log(err);
        if(result.length > 0){
        active_room[result.user1]=result.user2;
        revactives_room[result.user2]=result.user1;
        
            res.json(); //c'est quoi que je dois envoyer pour l'affichage??calcul?
            return;
        }
    }
});


app.get('/api/position',function(req,res) {
    var user1 = req.session.login;
    var reps = ' ';             
    for (var i in req.query){
        reps += i + ' ' + req.query[i] + '<br>\n'; //LATITUD ET LONGITUDE
    }
    for (user1 in active_room){
        var user2 = active_room.user2;
    } 
});


app.get('/api/notification',function(req,res) {
    res.send('blah!'); 
});

app.get('/api/userstream',function(req,res) {
  // On initialise les entêtes HTTP
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  // On envoye les entêtes
  res.writeHead(200);
  
  //Puis la première fois, on envoie la liste des utilisateurs connectés
  res.write('event: userschanged\n');
  res.write('data: '+JSON.stringify(connectes)+'\n\n');
  //Note: ici, on n'a pas fait de res.send('...') ou res.render(...), donc
  //le flux TCP reste ouvert... 
  //TODO:
  //Puis à chaque fois que la liste des utilisateurs est modifiée, on renvoie la
  //la nouvelle
 global_emitter.on("userschanged", function(event) {
     res.write('event: userschanged\n'); 
     res.write('data: '+JSON.stringify(connectes)+'\n\n');
  }); // partie 7.2
});
    
app.listen(8080);