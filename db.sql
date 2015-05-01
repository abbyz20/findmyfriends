USE c9;

DROP TABLE IF EXISTS `authorisation`;
DROP TABLE IF EXISTS `users`;


CREATE TABLE `users` (
  `login` varchar(255) PRIMARY KEY,
  `pass` varchar(255) NOT NULL,
  `nom` varchar(255) NOT NULL
);

CREATE TABLE `authorisation` (
  `user1` varchar(255),
  `user2` varchar(255) NOT NULL,
  `status` integer DEFAULT 0,
  PRIMARY KEY (user1, user2),
  constraint user1_fk foreign key(user1) references users(login),
  constraint user2_fk foreign key(user2) references users(login)
);


INSERT INTO `users` VALUES ('toto','totopass','Ana Toto');
INSERT INTO `users` VALUES ('toto2','toto2pass','Mira Toto2');
INSERT INTO `users` VALUES ('toto3','toto3pass','Lina Toto3');
