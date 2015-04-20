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
app.use('/img',express.static('static/img'));
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



function activeordesactive (user1, user2){
    if(active_room[user1]){
        delete revactives_room[active_room[user1]][user1];
        active_room[user1]=null;
        connectes[user1].notif_emitter.emit("RoomDeactivated");
    }
    
    
    if(user2){
        active_room[user1]=user2;
        if(!revactives_room[user2]){
            revactives_room[user2]=null;
        }
        revactives_room[user2][user1]=1;
        connectes[user1].notif_emitter.emit("RoomActivated",user2);
    }
}
  
  
    
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
            var user = req.session.login;
            connectes[user] = {login: user, nom: result[0].nom, notif_emitter: new evt.EventEmitter()};
            global_emitter.emit("userschanged", {login: user, nom: result[0].nom, status: 1}); // partie 7.1
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
        connectes[users].notif_emitter.emit("LogoutEvent"); // changement #2.
    }    
    
    delete revactives_room[user]; 
    var user2 = active_room[user];
    if(user2){//dont send me anything!
        delete revactives_room[user2][user];
    }
    
    delete active_room[user]; 
    db.query('DELETE FROM authorisation WHERE user1=? OR user2=?', [user, user]);
    

    global_emitter.emit("userschanged",{login: user, nom: connectes[user].nom, status:0}); // there seems to be a problem with NOM!!!
    delete connectes[user]; 
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
    
    reps.viewuser = active_room[user];
    
    db.query("(SELECT user1 AS user, 3 AS stat FROM authorisation WHERE status = 1 AND user2=?)"
    +" UNION (SELECT user2 AS user, 2 AS stat FROM authorisation WHERE status = 1 AND user1=?)"
    +" UNION (SELECT user2 AS user, 4 AS stat  FROM authorisation WHERE status = 2 AND user1=?)",[user, user, user], verification);
        return;
    
    function verification(err, result) {
        console.log(err);
            for(var i in  result){
                var r = result[i];
                console.log(r);
                if (!reps.connectedusers[r.user]) 
                reps.connectedusers[r.user]={login: r.user, nom: r.user, status: r.stat};
                reps.connectedusers[r.user].status = r.stat;
            }
    if (reps.connectedusers[user])
    {
        delete reps.connectedusers[user]; //delets user1 from the connected user list
    }
    
    res.json(reps);
    return;
    }
});


app.get('/api/invite',function(req,res) {
    var user1 = req.session.login;
    var user2 = req.query.user;
    db.query("SELECT status FROM authorisation WHERE (user1=? AND user2=?) OR (user2=? AND user1=?)" , [user1, user2, user1, user2], verification);
        return;
    
    function verification(err, result){
        if(err){
            res.json(err);
            return;
        }
        if (result.length>0){
           res.json("Already Invited");
           return 0;
        }
        db.query("INSERT INTO authorisation(user1, user2, status) VALUES(?,?,1)", [user1, user2], next1); //changement #1
    return;
    }

    function next1(err, result){
        if(err){
            res.json(err);
            return;
        }
        connectes[user1].notif_emitter.emit("userschanged", {login: user2, nom:connectes[user2].nom, status: 2});
        connectes[user2].notif_emitter.emit("userschanged", {login: user1, nom:connectes[user1].nom, status: 3});
        res.json(null);
        return 0;
    }
    
});
    
    
app.get('/api/invitationyes',function(req,res) {
    var user2 = req.session.login;
    var user1 = req.query.user;
    
        db.query("UPDATE authorisation SET status=2 WHERE user1=? AND user2=? AND status =1", [user1, user2], next1);
        return;
        
        function next1(err,result){
            
            if(err){
                res.json(err);
                return;
            }
            
            if (result.affectedRows==0){
                console.log("NotInvited");
                res.json("NotInvited");
                return;
            }
            
            db.query("INSERT INTO authorisation(user1, user2, status) VALUES(?,?,2)", [user2, user1]);//changement #3
            connectes[user1].notif_emitter.emit("userschanged", {login: user2, nom:connectes[user2].nom, status: 4});
            connectes[user2].notif_emitter.emit("userschanged", {login: user1, nom:connectes[user1].nom, status: 4});
              
            res.json(null);
            return 0;
        }
});
 
 
 
   
app.get('/api/invitationno',function(req,res) {
    var user2 = req.session.login;
    var user1 = req.query.user;
    db.query("DELETE FROM authorisation WHERE user1=? AND user2=? AND status = 1", [user1, user2], next1);
        return;
        function next1(err,result){
            
            if(err){
                res.json(err);
                return;
            }
            
            if (result.affectedRows==0){
                console.log("NotInvited");
                res.json("NotInvited");
                return;
            }
            
            connectes[user1].notif_emitter.emit("userschanged", {login: user2, nom:connectes[user2].nom, status: 1});
            connectes[user2].notif_emitter.emit("userschanged", {login: user1, nom:connectes[user1].nom, status: 1});
           
            res.json(null);
            return 0;
        }
});



app.get('/api/seelocation', function(req,res) {
    db.query("SELECT user1, user2 FROM authorisation WHERE user1=? AND user2=? AND status=2", [req.session.login, req.query.user], next1);
        return;

    function next1(err, result){
        if(err){
            console.log(err);
            res.json(err);
            return;
        }
        
        if(result.length > 0){
            activeordesactive(result.user1, result.user2);
            res.json(null);
            return;
        }
        
        if(result.length == 0){                             //changement 4
            console.log("Access Denied, please invite this person first");
            res.json("Access Denied, please invite this person first");
            return;
        }
    }
});



app.get('/api/finish',function(req,res) {
    var user1 = req.session.login;
    var user2 = req.query.user;
            
    db.query("DELETE FROM authorisation WHERE user1=? AND user2=? AND status=2", [user1, user2], next2);
        return;
        function next2(err,result){
            if(err){
                console.log(err);
                res.json(err);
                return;
            }
            
            if (result.affectedRows==0){
                console.log("You've never been Invited"); //changement #5
                 res.json("You've never been Invited");
                return;
            }
            
            db.query("DELETE FROM authorisation WHERE user1=? AND user2=? AND status=2", [user2, user1]); //changement #5
            connectes[user1].notif_emitter.emit("userschanged", {login: user2, nom:connectes[user2].nom, status: 1});
            connectes[user2].notif_emitter.emit("userschanged", {login: user1, nom:connectes[user1].nom, status: 1});
            
            activeordesactive(user1, null);
            activeordesactive(user2, null);
            
            res.json(null);
            return 0;
        }

});



app.get('/api/exit',function(req,res){
    activeordesactive(req.session.login,null);
    return;
});



app.get('/api/position',function(req,res) {
    var user1 = req.session.login;

    for (var user2 in revactives_room[user1]){
        //var user2 = active_room[user2];
        connectes[user2].notif_emitter.emit("GPSposition", res.json(req.query)); //changement #6  res.json(req.query) c'est bon?
    } 
    res.json(null); //il faut l'ameliorer!!! ajouter le calcul
});



app.get('/api/notification',function(req,res) {
  var user = req.session.login;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.writeHead(200);
  res.write('event: userschanged\n');
  res.write('data: '+JSON.stringify(connectes)+'\n\n');
    
    global_emitter.on("userschanged", function(event){
            res.write('event: userschanged\n'); 
            res.write('data: '+JSON.stringify(connectes)+'\n\n');
    }); 
    
    connectes[user].notif_emitter.on("userschanged", function(event){
        res.write('event: userschanged\n');
        res.write('data: '+JSON.stringify(event)+'\n\n'); 
    });
    
    connectes[user].notif_emitter.on("RoomActivated", function(event){
        res.write('event: RoomActivated\n');
        res.write('data: '+JSON.stringify(event)+'\n\n');
    });
    
    connectes[user].notif_emitter.on("RoomDeactivated", function(event){
        res.write('event: RoomActivated\n');
        res.write('data: '+JSON.stringify(event)+'\n\n');
    });
    
    connectes[user].notif_emitter.on("GPSposition", function(event){
        res.write('event: GPSposition\n');
        res.write('data: '+JSON.stringify(event)+'\n\n');
    });
});

    
app.listen(8080);
